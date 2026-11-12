-- Global employers with large engineering and operations centres in India, on Workday (board =
-- "<tenant>.<wdN>/<site>") and SmartRecruiters (company identifier). Each was checked live on
-- 2026-11-10 to have at least 10 open jobs in India; both providers now read only a board's India jobs
-- (listings/boards.ts). The number after each is the India jobs it listed that day.
insert into public.job_sources (provider, board, company, website, sync_every) values
  ('workday', 'accenture.wd103/AccentureCareers', 'Accenture', 'accenture.com', '6 hours'), -- 33876
  ('workday', 'citi.wd5/2', 'Citi', 'citi.com', '6 hours'), -- 923
  ('workday', 'hitachi.wd1/hitachi', 'Hitachi', 'hitachi.com', '6 hours'), -- 738
  ('smartrecruiters', 'BoschGroup', 'Bosch', 'bosch.com', '6 hours'), -- 592
  ('workday', 'hpe.wd5/ACJobSite', 'HPE', 'hpe.com', '6 hours'), -- 473
  ('workday', 'cisco.wd5/Cisco_Careers', 'Cisco', 'cisco.com', '6 hours'), -- 360
  ('workday', 'kyndryl.wd5/KyndrylProfessionalCareers', 'Kyndryl', 'kyndryl.com', '6 hours'), -- 331
  ('workday', 'thermofisher.wd5/ThermoFisherCareers', 'Thermo Fisher', 'thermofisher.com', '6 hours'), -- 294
  ('workday', 'db.wd3/DBWebSite', 'Deutsche Bank', 'db.com', '6 hours'), -- 293
  ('workday', 'maersk.wd3/Maersk_Careers', 'Maersk', 'maersk.com', '6 hours'), -- 245
  ('workday', 'mastercard.wd1/CorporateCareers', 'Mastercard', 'mastercard.com', '6 hours'), -- 228
  ('workday', 'statestreet.wd1/Global', 'State Street', 'statestreet.com', '6 hours'), -- 227
  ('workday', 'ag.wd3/Airbus', 'Airbus', 'airbus.com', '6 hours'), -- 214
  ('smartrecruiters', 'Nagarro1', 'Nagarro', 'nagarro.com', '6 hours'), -- 186
  ('workday', 'dxctechnology.wd1/DXCJobs', 'DXC Technology', 'dxc.com', '6 hours'), -- 178
  ('workday', 'amat.wd1/External', 'Applied Materials', 'appliedmaterials.com', '6 hours'), -- 165
  ('workday', 'jci.wd5/JCI', 'Johnson Controls', 'johnsoncontrols.com', '6 hours'), -- 151
  ('workday', 'cat.wd5/CaterpillarCareers', 'Caterpillar', 'caterpillar.com', '6 hours'), -- 145
  ('workday', 'cigna.wd5/cignacareers', 'Cigna', 'cigna.com', '6 hours'), -- 143
  ('workday', 'aptiv.wd5/APTIV_CAREERS', 'Aptiv', 'aptiv.com', '6 hours'), -- 129
  ('workday', 'novartis.wd3/Novartis_Careers', 'Novartis', 'novartis.com', '6 hours'), -- 127
  ('workday', 'microchiphr.wd5/External', 'Microchip', 'microchip.com', '6 hours'), -- 105
  ('workday', 'ntrs.wd1/northerntrust', 'Northern Trust', 'northerntrust.com', '6 hours'), -- 102
  ('workday', 'analogdevices.wd1/External', 'Analog Devices', 'analog.com', '6 hours'), -- 101
  ('workday', 'visa.wd5/Visa', 'VISA', 'visa.com', '6 hours'), -- 99
  ('workday', 'medtronic.wd1/MedtronicCareers', 'Medtronic', 'medtronic.com', '6 hours'), -- 98
  ('workday', 'hp.wd5/ExternalCareerSite', 'HP', 'hp.com', '6 hours'), -- 95
  ('workday', 'intel.wd1/External', 'Intel', 'intel.com', '6 hours'), -- 93
  ('workday', 'unisys.wd5/External', 'Unisys', 'unisys.com', '6 hours'), -- 93
  ('workday', 'stryker.wd1/StrykerCareers', 'Stryker', 'stryker.com', '6 hours'), -- 90
  ('workday', 'wf.wd1/WellsFargoJobs', 'Wells Fargo', 'wellsfargo.com', '6 hours'), -- 80
  ('workday', 'ms.wd5/External', 'Morgan Stanley', 'morganstanley.com', '6 hours'), -- 80
  ('workday', 'cba.wd3/CommBank_Careers', 'Commonwealth Bank', 'commbank.com.au', '6 hours'), -- 76
  ('workday', 'target.wd5/targetcareers', 'Target', 'target.com', '6 hours'), -- 69
  ('smartrecruiters', 'NielsenIQ', 'NielsenIQ', 'nielseniq.com', '6 hours'), -- 69
  ('workday', 'relx.wd3/relx', 'RELX', 'relx.com', '6 hours'), -- 65
  ('workday', 'philips.wd3/jobs-and-careers', 'Philips', 'philips.com', '6 hours'), -- 64
  ('workday', 'spgi.wd5/SPGI_Careers', 'S&P Global', 'spglobal.com', '6 hours'), -- 54
  ('workday', 'wk.wd3/External', 'Wolters Kluwer', 'wolterskluwer.com', '6 hours'), -- 51
  ('workday', 'rockwellautomation.wd1/External_Rockwell_Automation', 'Rockwell Automation', 'rockwellautomation.com', '6 hours'), -- 49
  ('workday', 'carrier.wd5/jobs', 'Carrier', 'carrier.com', '6 hours'), -- 47
  ('workday', 'ameriprise.wd5/Ameriprise', 'Ameriprise', 'ameriprise.com', '6 hours'), -- 46
  ('workday', 'mdlz.wd3/External', 'Mondelez', 'mondelezinternational.com', '6 hours'), -- 44
  ('workday', 'diageo.wd3/Diageo_Careers', 'Diageo', 'diageo.com', '6 hours'), -- 43
  ('workday', 'guidewire.wd5/external', 'Guidewire', 'guidewire.com', '6 hours'), -- 43
  ('workday', 'motorolasolutions.wd5/Careers', 'Motorola Solutions', 'motorolasolutions.com', '6 hours'), -- 40
  ('workday', 'marvell.wd1/MarvellCareers', 'Marvell', 'marvell.com', '6 hours'), -- 39
  ('smartrecruiters', 'Experian', 'Experian', 'experian.com', '6 hours'), -- 38
  ('workday', 'blackrock.wd1/BlackRock_Professional', 'BlackRock', 'blackrock.com', '6 hours'), -- 35
  ('workday', 'athenahealth.wd1/External', 'athenahealth', 'athenahealth.com', '6 hours'), -- 34
  ('workday', 'nasdaq.wd1/Global_External_Site', 'Nasdaq', 'nasdaq.com', '6 hours'), -- 33
  ('workday', 'gartner.wd5/EXT', 'Gartner', 'gartner.com', '6 hours'), -- 33
  ('smartrecruiters', 'Freshworks', 'Freshworks', 'freshworks.com', '6 hours'), -- 32
  ('workday', 'sec.wd3/Samsung_Careers', 'Samsung', 'samsung.com', '6 hours'), -- 31
  ('workday', 'pg.wd5/1000', 'Procter & Gamble', 'pg.com', '6 hours'), -- 30
  ('workday', 'astrazeneca.wd3/Careers', 'AstraZeneca', 'astrazeneca.com', '6 hours'), -- 29
  ('workday', 'paypal.wd1/jobs', 'PayPal', 'paypal.com', '6 hours'), -- 28
  ('workday', 'equinix.wd1/External', 'Equinix', 'equinix.com', '6 hours'), -- 28
  ('workday', 'disney.wd5/disneycareer', 'Disney', 'disney.com', '6 hours'), -- 24
  ('workday', 'pfizer.wd1/PfizerCareers', 'Pfizer', 'pfizer.com', '6 hours'), -- 22
  ('workday', 'baxter.wd1/baxter', 'Baxter', 'baxter.com', '6 hours'), -- 22
  ('workday', 'cardinalhealth.wd1/EXT', 'Cardinal Health', 'cardinalhealth.com', '6 hours'), -- 22
  ('workday', 'shell.wd3/ShellCareers', 'Shell', 'shell.com', '6 hours'), -- 15
  ('smartrecruiters', 'Continental', 'Continental', 'continental.com', '6 hours'), -- 13
  ('workday', 'ciena.wd5/Careers', 'Ciena', 'ciena.com', '6 hours'), -- 12
  ('workday', 'trellix.wd1/EnterpriseCareers', 'Trellix', 'trellix.com', '6 hours')  -- 10
on conflict (provider, board) do nothing;
