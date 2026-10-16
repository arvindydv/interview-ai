//! Live audio capture (spec B1–B3): the interviewer from the system output (loopback) and the
//! candidate from the microphone, as 80 ms frames of 16 kHz mono s16le PCM. Each frame is prefixed
//! with its source byte, ready to send as a binary message on the live channel (AUDIO_SOURCE_BYTE
//! in packages/shared/src/live.ts).
//!
//! Linux records through PulseAudio/PipeWire's `parec` (the default sink's monitor is the system
//! output), which also resamples. Windows and macOS use cpal: WASAPI loopback, and Core Audio
//! process taps on macOS 14.6+.

use std::{
    sync::{
        mpsc::{self, RecvTimeoutError},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

pub const SAMPLE_RATE: u32 = 16_000;
/// 80 ms per frame, the chunk size Deepgram recommends for Flux.
const FRAME_SAMPLES: usize = 1280;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Interviewer,
    You,
}

impl Source {
    pub const ALL: [Source; 2] = [Source::Interviewer, Source::You];

    fn byte(self) -> u8 {
        match self {
            Source::Interviewer => 0,
            Source::You => 1,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Source::Interviewer => "interviewer",
            Source::You => "you",
        }
    }
}

/// Receives each tagged frame.
pub type Sink = Arc<dyn Fn(Vec<u8>) + Send + Sync>;
/// Called at most once, if capture stops on its own (device unplugged, permission revoked).
pub type OnFail = Box<dyn FnOnce(String) + Send>;
type Stop = Box<dyn FnOnce() + Send>;

/// A running capture. Dropping it stops the capture.
pub struct Capture {
    stop: Option<Stop>,
}

impl Drop for Capture {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            stop();
        }
    }
}

/// Starts capturing `source`. Blocks briefly while the device opens, so call it off the main thread.
pub fn start(source: Source, sink: Sink, on_fail: OnFail) -> Result<Capture, String> {
    let (tx, rx) = mpsc::channel::<Vec<i16>>();
    let stop = backend::start(source, tx, on_fail)?;
    thread::Builder::new()
        .name(format!("audio-{}", source.name()))
        .spawn(move || pump(source, rx, sink))
        .map_err(|e| e.to_string())?;
    Ok(Capture { stop: Some(stop) })
}

/// Cuts the sample stream into tagged frames. Fills gaps with silence: some devices deliver nothing
/// while nothing plays (WASAPI loopback), but speech-to-text has to hear the silence to notice
/// that a question has ended. Returns when the backend drops its sender.
fn pump(source: Source, rx: mpsc::Receiver<Vec<i16>>, sink: Sink) {
    let mut buf: Vec<i16> = Vec::with_capacity(FRAME_SAMPLES * 4);
    let mut last = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(120)) {
            Ok(samples) => {
                buf.extend_from_slice(&samples);
                last = Instant::now();
            }
            Err(RecvTimeoutError::Timeout) => {
                let missing = (last.elapsed().as_secs_f64() * SAMPLE_RATE as f64) as usize;
                buf.resize(buf.len() + missing, 0);
                last = Instant::now();
            }
            Err(RecvTimeoutError::Disconnected) => return,
        }
        while buf.len() >= FRAME_SAMPLES {
            let mut frame = Vec::with_capacity(1 + FRAME_SAMPLES * 2);
            frame.push(source.byte());
            for s in buf.drain(..FRAME_SAMPLES) {
                frame.extend_from_slice(&s.to_le_bytes());
            }
            sink(frame);
        }
    }
}

#[cfg(target_os = "linux")]
mod backend {
    use super::*;
    use std::{
        io::Read,
        process::{Command, Stdio},
        sync::{
            atomic::{AtomicBool, Ordering},
            Mutex,
        },
    };

    pub fn start(source: Source, tx: mpsc::Sender<Vec<i16>>, on_fail: OnFail) -> Result<Stop, String> {
        let device = match source {
            Source::Interviewer => "@DEFAULT_MONITOR@",
            Source::You => "@DEFAULT_SOURCE@",
        };
        let mut child = Command::new("parec")
            .args([
                &format!("--device={device}"),
                "--format=s16le",
                &format!("--rate={SAMPLE_RATE}"),
                "--channels=1",
                "--raw",
                "--latency-msec=20",
                "--client-name=Parakeet",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => {
                    "Audio capture needs `parec`. Install pulseaudio-utils (or pipewire-pulse) and restart Parakeet.".to_string()
                }
                _ => format!("Couldn't start audio capture: {e}"),
            })?;
        let mut stdout = child.stdout.take().ok_or("no stdout")?;
        let mut stderr = child.stderr.take().ok_or("no stderr")?;
        let child = Arc::new(Mutex::new(child));
        let stopped = Arc::new(AtomicBool::new(false));

        let (reader_child, reader_stopped) = (child.clone(), stopped.clone());
        thread::Builder::new()
            .name(format!("parec-{}", source.name()))
            .spawn(move || {
                let mut bytes = [0u8; 2560];
                let mut odd: Option<u8> = None;
                loop {
                    let n = match stdout.read(&mut bytes) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => n,
                    };
                    let mut data: Vec<u8> = Vec::with_capacity(n + 1);
                    data.extend(odd.take());
                    data.extend_from_slice(&bytes[..n]);
                    if data.len() % 2 == 1 {
                        odd = data.pop();
                    }
                    let samples = data.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
                    if tx.send(samples).is_err() {
                        break;
                    }
                }
                if reader_stopped.load(Ordering::SeqCst) {
                    return;
                }
                let _ = reader_child.lock().unwrap().wait();
                let mut detail = String::new();
                let _ = stderr.read_to_string(&mut detail);
                let detail = detail.lines().last().unwrap_or("").trim().to_string();
                let what = match source {
                    Source::Interviewer => "System audio capture",
                    Source::You => "Microphone capture",
                };
                on_fail(if detail.is_empty() { format!("{what} stopped.") } else { format!("{what} stopped: {detail}") });
            })
            .map_err(|e| e.to_string())?;

        Ok(Box::new(move || {
            stopped.store(true, Ordering::SeqCst);
            let mut child = child.lock().unwrap();
            let _ = child.kill();
            let _ = child.wait();
        }))
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
mod backend {
    use super::*;
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::Mutex;

    /// cpal streams aren't Send on every platform, so each lives on its own thread until stopped.
    pub fn start(source: Source, tx: mpsc::Sender<Vec<i16>>, on_fail: OnFail) -> Result<Stop, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        thread::Builder::new()
            .name(format!("cpal-{}", source.name()))
            .spawn(move || {
                let stream = match open(source, tx, on_fail) {
                    Ok(stream) => stream,
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                // Until stop() is called (or the Capture is dropped, which drops the sender).
                let _ = stop_rx.recv();
                drop(stream);
            })
            .map_err(|e| e.to_string())?;
        ready_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "The audio device didn't respond.".to_string())??;
        Ok(Box::new(move || {
            let _ = stop_tx.send(());
        }))
    }

    fn open(source: Source, tx: mpsc::Sender<Vec<i16>>, on_fail: OnFail) -> Result<cpal::Stream, String> {
        let host = cpal::default_host();
        // An output device opened for input records what it plays (loopback).
        let (device, config) = match source {
            Source::Interviewer => {
                let device = host.default_output_device().ok_or("No speaker or headphone output was found.")?;
                let config = device.default_output_config().map_err(|e| format!("System audio: {e}"))?;
                (device, config)
            }
            Source::You => {
                let device = host.default_input_device().ok_or("No microphone was found.")?;
                let config = device.default_input_config().map_err(|e| format!("Microphone: {e}"))?;
                (device, config)
            }
        };
        let format = config.sample_format();
        let channels = config.channels().max(1) as usize;
        let mut resampler = Resampler::new(config.sample_rate());
        let on_fail = Mutex::new(Some(on_fail));
        let stream = device
            .build_input_stream_raw(
                config.config(),
                format,
                move |data: &cpal::Data, _: &cpal::InputCallbackInfo| {
                    let mono = to_mono(data, channels);
                    if !mono.is_empty() {
                        let _ = tx.send(resampler.process(&mono));
                    }
                },
                move |err: cpal::Error| {
                    use cpal::ErrorKind::*;
                    // Glitches and default-device switches are handled by cpal; the rest end the stream.
                    if matches!(err.kind(), Xrun | DeviceChanged | RealtimeDenied) {
                        log::debug!("audio {}: {err}", source.name());
                        return;
                    }
                    log::warn!("audio {}: {err}", source.name());
                    if let Some(f) = on_fail.lock().unwrap().take() {
                        f(err.to_string());
                    }
                },
                None,
            )
            .map_err(|e| describe(source, e))?;
        stream.play().map_err(|e| describe(source, e))?;
        Ok(stream)
    }

    fn describe(source: Source, e: cpal::Error) -> String {
        match (source, e.kind()) {
            (_, cpal::ErrorKind::PermissionDenied) if cfg!(target_os = "macos") => match source {
                Source::Interviewer => "Allow Parakeet to record system audio in System Settings → Privacy & Security → Screen & System Audio Recording.".into(),
                Source::You => "Allow Parakeet to use the microphone in System Settings → Privacy & Security → Microphone.".into(),
            },
            (_, cpal::ErrorKind::PermissionDenied) => match source {
                Source::Interviewer => format!("System audio access was denied: {e}"),
                Source::You => "Allow microphone access in Settings → Privacy & security → Microphone.".into(),
            },
            (Source::Interviewer, _) if cfg!(target_os = "macos") => {
                format!("Couldn't record system audio (needs macOS 14.6 or later): {e}")
            }
            (Source::Interviewer, _) => format!("Couldn't record system audio: {e}"),
            (Source::You, _) => format!("Couldn't open the microphone: {e}"),
        }
    }

    fn to_mono(data: &cpal::Data, channels: usize) -> Vec<f32> {
        fn mix<T: Copy>(samples: &[T], channels: usize, f: impl Fn(T) -> f32) -> Vec<f32> {
            samples
                .chunks(channels)
                .map(|frame| frame.iter().map(|&s| f(s)).sum::<f32>() / frame.len() as f32)
                .collect()
        }
        use cpal::SampleFormat as F;
        match data.sample_format() {
            F::F32 => data.as_slice::<f32>().map(|s| mix(s, channels, |x| x)),
            F::F64 => data.as_slice::<f64>().map(|s| mix(s, channels, |x| x as f32)),
            F::I16 => data.as_slice::<i16>().map(|s| mix(s, channels, |x| x as f32 / 32_768.0)),
            F::I32 => data.as_slice::<i32>().map(|s| mix(s, channels, |x| x as f32 / 2_147_483_648.0)),
            F::U16 => data.as_slice::<u16>().map(|s| mix(s, channels, |x| (x as f32 - 32_768.0) / 32_768.0)),
            _ => None,
        }
        .unwrap_or_default()
    }
}

/// Streaming conversion from the device rate to 16 kHz. Downsampling averages the input samples in
/// each output period (a box filter, enough to keep aliasing out of speech); upsampling (8 kHz
/// headsets) interpolates linearly.
#[cfg(any(target_os = "windows", target_os = "macos", test))]
struct Resampler {
    /// Input samples per output sample.
    step: f64,
    t: f64,
    acc: f32,
    n: u32,
    prev: f32,
}

#[cfg(any(target_os = "windows", target_os = "macos", test))]
impl Resampler {
    fn new(input_rate: u32) -> Self {
        Self { step: input_rate as f64 / SAMPLE_RATE as f64, t: 0.0, acc: 0.0, n: 0, prev: 0.0 }
    }

    fn process(&mut self, input: &[f32]) -> Vec<i16> {
        let to_i16 = |x: f32| (x.clamp(-1.0, 1.0) * 32_767.0) as i16;
        let mut out = Vec::with_capacity((input.len() as f64 / self.step) as usize + 2);
        if self.step >= 1.0 {
            for &x in input {
                self.acc += x;
                self.n += 1;
                self.t += 1.0;
                if self.t >= self.step {
                    out.push(to_i16(self.acc / self.n as f32));
                    self.acc = 0.0;
                    self.n = 0;
                    self.t -= self.step;
                }
            }
        } else {
            for &x in input {
                while self.t < 1.0 {
                    out.push(to_i16(self.prev + (x - self.prev) * self.t as f32));
                    self.t += self.step;
                }
                self.t -= 1.0;
                self.prev = x;
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn count(rate: u32, seconds: usize) -> usize {
        let mut r = Resampler::new(rate);
        let input = vec![0.25f32; rate as usize * seconds];
        // Odd-sized chunks, like device callbacks.
        input.chunks(441).map(|c| r.process(c).len()).sum()
    }

    #[test]
    fn resamples_common_rates_to_16k() {
        for rate in [8_000, 16_000, 22_050, 44_100, 48_000, 96_000] {
            let n = count(rate, 3);
            assert!((n as i64 - 48_000).abs() <= 2, "{rate} Hz → {n} samples in 3 s");
        }
    }

    #[test]
    fn keeps_the_signal_level() {
        let mut r = Resampler::new(48_000);
        let out = r.process(&vec![0.5f32; 4800]);
        assert!(out.iter().all(|&s| (s - 16_383).abs() <= 1));
    }
}
