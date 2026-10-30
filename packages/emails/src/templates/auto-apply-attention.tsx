import { Layout } from '../components/Layout.js';
import { Button, Details, Eyebrow, P, Title } from '../components/blocks.js';
import { brand } from '../theme.js';

export interface AutoApplyAttentionEmailProps {
  name: string;
  /** Website URL, for the email's header and footer links. */
  appUrl: string;
  /** Friday Jobs URL. */
  jobsUrl: string;
  /** Applications waiting for the user, e.g. [["Needs your answers", "3"], ["Needs a CAPTCHA", "1"]]. */
  waiting: [string, string][];
}

export function AutoApplyAttentionEmail({ name, appUrl, jobsUrl, waiting }: AutoApplyAttentionEmailProps) {
  return (
    <Layout
      appUrl={appUrl}
      preview="Some of your applications are waiting for you"
      footerNote={<>You’re getting this because Auto Apply is on. Turn it off any time on the Auto Apply page.</>}
    >
      <Eyebrow>Auto Apply</Eyebrow>
      <Title>{name ? `${name}, some` : 'Some'} applications need you</Title>
      <P>
        {brand.name} prepared these applications but stopped before sending them, because they need something only you
        can give: an answer we couldn’t take from your resume or profile, or a check a job board asked for.
      </P>
      <Details rows={waiting} />
      <P>Your answers are saved, so the same question won’t stop another application.</P>
      <Button href={`${jobsUrl}/auto-apply?status=pending`}>Review applications</Button>
    </Layout>
  );
}
