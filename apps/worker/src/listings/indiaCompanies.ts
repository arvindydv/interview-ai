// More employers hiring software and tech roles in India, for discovery (queues/discovery.ts) alongside
// indiaStartups.ts: Indian startups and product companies, IT and engineering services firms, and
// global companies with large engineering centres in India. Discovery follows each one's careers link
// to its board (listings/careersLink.ts); a company whose board isn't on a supported provider is just
// re-checked monthly, so a wrong or missing website costs nothing but the check.

const COMPANIES: [name: string, website: string][] = [
  // Consumer internet, commerce and marketplaces
  ['Meesho', 'meesho.com'], ['CRED', 'cred.club'], ['Groww', 'groww.in'], ['Flipkart', 'flipkart.com'], ['Myntra', 'myntra.com'],
  ['Paytm', 'paytm.com'], ['OYO', 'oyorooms.com'], ['MakeMyTrip', 'makemytrip.com'], ['Yatra', 'yatra.com'], ['BigBasket', 'bigbasket.com'],
  ['Tata Digital', 'tatadigital.com'], ['Tata CLiQ', 'tatacliq.com'], ['Purplle', 'purplle.com'], ['FirstCry', 'firstcry.com'],
  ['Snapdeal', 'snapdeal.com'], ['IndiaMART', 'indiamart.com'], ['Justdial', 'justdial.com'], ['Info Edge', 'infoedge.in'],
  ['Housing.com', 'housing.com'], ['MagicBricks', 'magicbricks.com'], ['CarDekho', 'cardekho.com'], ['CarWale', 'carwale.com'],
  ['Droom', 'droom.in'], ['OLX India', 'olx.in'], ['Quikr', 'quikr.com'], ['DealShare', 'dealshare.in'], ['CityMall', 'citymall.live'],
  ['Rebel Foods', 'rebelfoods.com'], ['Box8', 'box8.in'], ['FreshToHome', 'freshtohome.com'], ['Urban Ladder', 'urbanladder.com'],
  ['Livspace', 'livspace.com'], ['HomeLane', 'homelane.com'], ['Design Cafe', 'designcafe.com'], ['PropTiger', 'proptiger.com'],
  ['FabHotels', 'fabhotels.com'], ['Zostel', 'zostel.com'], ['Thrillophilia', 'thrillophilia.com'], ['The Souled Store', 'thesouledstore.com'],
  ['Snitch', 'snitch.co.in'], ['Zivame', 'zivame.com'], ['BlueStone', 'bluestone.com'], ['CaratLane', 'caratlane.com'],
  ['Mensa Brands', 'mensabrands.com'], ['GlobalBees', 'globalbees.com'], ['Pilgrim', 'discoverpilgrim.com'], ['Minimalist', 'beminimalist.co'],
  ['Plum Goodness', 'plumgoodness.com'], ['Bombay Shaving Company', 'bombayshavingcompany.com'], ['Noise', 'gonoise.com'],
  ['Duroflex', 'duroflexworld.com'], ['Atomberg', 'atomberg.com'], ['Bizongo', 'bizongo.com'], ['Fynd', 'fynd.com'], ['GoKwik', 'gokwik.co'],
  ['Shopflo', 'shopflo.com'], ['Dukaan', 'mydukaan.io'], ['Instamojo', 'instamojo.com'], ['DotPe', 'dotpe.in'], ['Petpooja', 'petpooja.com'],
  ['UrbanPiper', 'urbanpiper.com'], ['Times Internet', 'timesinternet.in'], ['ZEE5', 'zee5.com'], ['JioSaavn', 'jiosaavn.com'],
  ['Gaana', 'gaana.com'], ['VerSe Innovation', 'verse.in'], ['Pubmatic', 'pubmatic.com'], ['Media.net', 'media.net'], ['Sprinklr', 'sprinklr.com'],
  // Fintech
  ['PayU', 'payu.in'], ['BillDesk', 'billdesk.com'], ['Zeta', 'zeta.tech'], ['Uni Cards', 'uni.club'], ['OneCard', 'getonecard.app'],
  ['Paisabazaar', 'paisabazaar.com'], ['BankBazaar', 'bankbazaar.com'], ['Turtlemint', 'turtlemint.com'], ['InsuranceDekho', 'insurancedekho.com'],
  ['Upstox', 'upstox.com'], ['Dhan', 'dhan.co'], ['Angel One', 'angelone.in'], ['5paisa', '5paisa.com'], ['Kuvera', 'kuvera.in'],
  ['ET Money', 'etmoney.com'], ['Scripbox', 'scripbox.com'], ['Fyers', 'fyers.in'], ['Sensibull', 'sensibull.com'], ['Lentra', 'lentra.ai'],
  ['FinBox', 'finbox.in'], ['Decentro', 'decentro.tech'], ['Freo', 'freo.money'], ['Fibe', 'fibe.in'], ['Aye Finance', 'ayefin.com'],
  ['UGRO Capital', 'ugrocapital.com'], ['Vivriti Capital', 'vivriticapital.com'], ['Yubi', 'go-yubi.com'], ['Progcap', 'progcap.com'],
  ['Mintifi', 'mintifi.com'], ['Vyapar', 'vyaparapp.in'], ['myBillBook', 'mybillbook.in'], ['Clear', 'cleartax.in'], ['Tally Solutions', 'tallysolutions.com'],
  ['Mswipe', 'mswipe.com'], ['WazirX', 'wazirx.com'], ['Mudrex', 'mudrex.com'], ['Polygon', 'polygon.technology'], ['HyperVerge', 'hyperverge.co'],
  ['Leegality', 'leegality.com'], ['SpotDraft', 'spotdraft.com'],
  // SaaS, developer tools, data and AI
  ['Druva', 'druva.com'], ['Ozonetel', 'ozonetel.com'], ['Knowlarity', 'knowlarity.com'], ['Vue.ai', 'vue.ai'], ['MathCo', 'themathcompany.com'],
  ['Course5 Intelligence', 'course5i.com'], ['Tredence', 'tredence.com'], ['Quantiphi', 'quantiphi.com'], ['Gramener', 'gramener.com'],
  ['Kore.ai', 'kore.ai'], ['Verloop.io', 'verloop.io'], ['Engati', 'engati.com'], ['Wati', 'wati.io'], ['Unicommerce', 'unicommerce.com'],
  ['Increff', 'increff.com'], ['LogiNext', 'loginextsolutions.com'], ['FarEye', 'fareye.com'], ['Shipsy', 'shipsy.io'], ['Vymo', 'getvymo.com'],
  ['Recruit CRM', 'recruitcrm.io'], ['Keka', 'keka.com'], ['greytHR', 'greythr.com'], ['HROne', 'hrone.cloud'], ['PeopleStrong', 'peoplestrong.com'],
  ['Springworks', 'springworks.in'], ['Hubilo', 'hubilo.com'], ['Toddle', 'toddleapp.com'], ['LEAD School', 'leadschool.in'], ['ThoughtSpot', 'thoughtspot.com'],
  ['Sarvam AI', 'sarvam.ai'], ['Gnani.ai', 'gnani.ai'], ['Wadhwani AI', 'wadhwaniai.org'], ['Directi', 'directi.com'], ['Zoho', 'zoho.com'],
  ['Freshworks', 'freshworks.com'], ['Postman', 'postman.com'], ['Exotel', 'exotel.com'], ['Juspay', 'juspay.in'], ['InMobi', 'inmobi.com'],
  // Education and careers
  ['BYJU’S', 'byjus.com'], ['Great Learning', 'mygreatlearning.com'], ['Doubtnut', 'doubtnut.com'], ['Sunstone', 'sunstone.in'],
  ['Masai School', 'masaischool.com'], ['Newton School', 'newtonschool.co'], ['Coding Ninjas', 'codingninjas.com'], ['GeeksforGeeks', 'geeksforgeeks.org'],
  ['HackerEarth', 'hackerearth.com'], ['HackerRank', 'hackerrank.com'], ['Unstop', 'unstop.com'], ['Internshala', 'internshala.com'],
  ['foundit', 'foundit.in'], ['WorkIndia', 'workindia.in'], ['PlanetSpark', 'planetspark.in'],
  // Gaming
  ['Nazara Technologies', 'nazara.com'], ['Junglee Games', 'jungleegames.com'], ['Gameskraft', 'gameskraft.com'], ['Head Digital Works', 'headdigitalworks.com'],
  ['Rooter', 'rooter.gg'], ['SuperGaming', 'supergaming.com'], ['Octro', 'octro.com'], ['Moonfrog Labs', 'moonfroglabs.com'],
  // Mobility, logistics, energy, agri, space
  ['Ola Electric', 'olaelectric.com'], ['Bounce', 'bounceshare.com'], ['BluSmart', 'blu-smart.com'], ['Rivigo', 'rivigo.com'], ['Arya.ag', 'arya.ag'],
  ['Bijak', 'bijak.in'], ['Cropin', 'cropin.com'], ['Digantara', 'digantara.co.in'], ['Bellatrix Aerospace', 'bellatrix.aero'],
  ['ideaForge', 'ideaforgetech.com'], ['Tonbo Imaging', 'tonboimaging.com'], ['Log9 Materials', 'log9materials.com'], ['Exponent Energy', 'exponent.energy'],
  ['Simple Energy', 'simpleenergy.in'], ['River', 'rideriver.com'], ['Ultraviolette', 'ultraviolette.com'], ['Euler Motors', 'eulermotors.com'],
  ['Statiq', 'statiq.in'],
  // Health
  ['Niramai', 'niramai.com'], ['Tricog', 'tricog.com'], ['Onsurity', 'onsurity.com'], ['Loop Health', 'loophealth.com'], ['Truemeds', 'truemeds.in'],
  ['Netmeds', 'netmeds.com'], ['Apollo 24|7', 'apollo247.com'], ['Eka Care', 'eka.care'], ['HealthPlix', 'healthplix.com'],
  // IT, engineering and product services
  ['TCS', 'tcs.com'], ['Infosys', 'infosys.com'], ['Wipro', 'wipro.com'], ['HCLTech', 'hcltech.com'], ['Tech Mahindra', 'techmahindra.com'],
  ['LTIMindtree', 'ltimindtree.com'], ['Mphasis', 'mphasis.com'], ['Persistent Systems', 'persistent.com'], ['Coforge', 'coforge.com'],
  ['Hexaware', 'hexaware.com'], ['Zensar', 'zensar.com'], ['Birlasoft', 'birlasoft.com'], ['Cyient', 'cyient.com'], ['KPIT', 'kpit.com'],
  ['Tata Elxsi', 'tataelxsi.com'], ['L&T Technology Services', 'ltts.com'], ['Sasken', 'sasken.com'], ['Happiest Minds', 'happiestminds.com'],
  ['Mastek', 'mastek.com'], ['Sonata Software', 'sonata-software.com'], ['Nagarro', 'nagarro.com'], ['EPAM', 'epam.com'], ['Thoughtworks', 'thoughtworks.com'],
  ['Publicis Sapient', 'publicissapient.com'], ['Infogain', 'infogain.com'], ['Virtusa', 'virtusa.com'], ['HashedIn', 'hashedin.com'], ['Accolite', 'accolite.com'],
  ['Xoriant', 'xoriant.com'], ['GlobalLogic', 'globallogic.com'], ['Mindfire Solutions', 'mindfiresolutions.com'], ['QuEST Global', 'quest-global.com'],
  ['Ramco Systems', 'ramco.com'], ['Newgen Software', 'newgensoft.com'], ['Intellect Design Arena', 'intellectdesign.com'], ['Nucleus Software', 'nucleussoftware.com'],
  ['Sify Technologies', 'sifytechnologies.com'], ['Tata Communications', 'tatacommunications.com'], ['Jio Platforms', 'jio.com'],
  ['Mercedes-Benz R&D India', 'mbrdi.co.in'],
  // Global companies with large engineering centres in India
  ['Walmart Global Tech', 'walmart.com'], ['Target', 'target.com'], ['Lowe’s', 'lowes.com'], ['Intuit', 'intuit.com'], ['PayPal', 'paypal.com'],
  ['Visa', 'visa.com'], ['Mastercard', 'mastercard.com'], ['American Express', 'americanexpress.com'], ['Intel', 'intel.com'], ['Qualcomm', 'qualcomm.com'],
  ['Cisco', 'cisco.com'], ['Broadcom', 'broadcom.com'], ['Atlassian', 'atlassian.com'], ['Rubrik', 'rubrik.com'], ['Nutanix', 'nutanix.com'],
  ['Zscaler', 'zscaler.com'], ['Palo Alto Networks', 'paloaltonetworks.com'], ['Akamai', 'akamai.com'], ['Cohesity', 'cohesity.com'], ['Okta', 'okta.com'],
  ['Twilio', 'twilio.com'], ['Stripe', 'stripe.com'], ['Coinbase', 'coinbase.com'], ['Databricks', 'databricks.com'], ['Snowflake', 'snowflake.com'],
  ['MongoDB', 'mongodb.com'], ['Confluent', 'confluent.io'], ['Elastic', 'elastic.co'], ['GitLab', 'gitlab.com'], ['Deel', 'deel.com'],
  ['Remote', 'remote.com'], ['Grab', 'grab.com'], ['Gojek', 'gojek.com'], ['Expedia Group', 'expediagroup.com'], ['Booking.com', 'booking.com'],
  ['Agoda', 'agoda.com'], ['Sabre', 'sabre.com'], ['Amadeus', 'amadeus.com'], ['Autodesk', 'autodesk.com'], ['Synopsys', 'synopsys.com'],
  ['Cadence', 'cadence.com'], ['Siemens', 'siemens.com'], ['Bosch', 'bosch.com'], ['Honeywell', 'honeywell.com'], ['GE HealthCare', 'gehealthcare.com'],
  ['Philips', 'philips.com'], ['Tesco', 'tesco.com'], ['The Home Depot', 'homedepot.com'], ['Wayfair', 'wayfair.com'], ['eBay', 'ebayinc.com'],
  ['Ericsson', 'ericsson.com'], ['Nokia', 'nokia.com'], ['HARMAN', 'harman.com'], ['Continental', 'continental.com'], ['Uber', 'uber.com'],
  ['Adobe', 'adobe.com'], ['Salesforce', 'salesforce.com'], ['ServiceNow', 'servicenow.com'], ['NVIDIA', 'nvidia.com'], ['SAP', 'sap.com'],
  ['VMware', 'vmware.com'], ['Dell Technologies', 'dell.com'], ['HP', 'hp.com'], ['Hewlett Packard Enterprise', 'hpe.com'], ['NetApp', 'netapp.com'],
  ['Juniper Networks', 'juniper.net'], ['Arista Networks', 'arista.com'], ['F5', 'f5.com'], ['Fortinet', 'fortinet.com'], ['Check Point', 'checkpoint.com'],
  ['CrowdStrike', 'crowdstrike.com'], ['Workday', 'workday.com'], ['Splunk', 'splunk.com'], ['Dropbox', 'dropbox.com'], ['Zendesk', 'zendesk.com'],
  ['HubSpot', 'hubspot.com'], ['DocuSign', 'docusign.com'], ['Box', 'box.com'], ['Citrix', 'citrix.com'], ['Informatica', 'informatica.com'],
  ['Teradata', 'teradata.com'], ['Fiserv', 'fiserv.com'], ['FIS', 'fisglobal.com'], ['Broadridge', 'broadridge.com'], ['Morningstar', 'morningstar.com'],
  ['S&P Global', 'spglobal.com'], ['MSCI', 'msci.com'], ['LSEG', 'lseg.com'], ['Nasdaq', 'nasdaq.com'], ['Thomson Reuters', 'thomsonreuters.com'],
  ['Wolters Kluwer', 'wolterskluwer.com'], ['Gartner', 'gartner.com'], ['McAfee', 'mcafee.com'], ['Gen Digital', 'gendigital.com'], ['Trellix', 'trellix.com'],
  ['Zebra Technologies', 'zebra.com'], ['Western Digital', 'westerndigital.com'], ['Micron', 'micron.com'], ['AMD', 'amd.com'], ['Texas Instruments', 'ti.com'],
  ['Analog Devices', 'analog.com'], ['NXP', 'nxp.com'], ['Infineon', 'infineon.com'], ['Marvell', 'marvell.com'], ['Arm', 'arm.com'],
  ['Applied Materials', 'appliedmaterials.com'], ['KLA', 'kla.com'], ['Lam Research', 'lamresearch.com'], ['Keysight', 'keysight.com'], ['Rakuten', 'rakuten.com'],
  ['Swiggy', 'swiggy.com'], ['Zomato', 'zomato.com'], ['PhonePe', 'phonepe.com'], ['Razorpay', 'razorpay.com'],
];

export const INDIA_COMPANIES: { name: string; website: string }[] = COMPANIES.map(([name, website]) => ({ name, website }));
