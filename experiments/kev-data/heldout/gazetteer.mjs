// The code gazetteer for the held-out city lists (JUDGE-PROGRAM.md §1.2 R1: "held-out cities (authored
// list, checked against a gazetteer by code)"). A general city -> ISO country table over the 18
// countries of the records country pool (spec/ports.json R5 options); it is NOT the held-out list
// (it is several times larger and marks nothing), so committing it reveals no held-out entity.
// A name that occurs in more than one country of the table is ambiguous: `lookup` returns every
// country, and a held-out city must have exactly one. Namesakes of about 25K people or more (or a common
// exonym, e.g. Syracuse for Siracusa, Freiburg for Fribourg) are listed under every country they occur in;
// the 2026-10-08 review added 19 that the first version missed (Portsmouth VA, Parma OH, Newark-on-Trent,
// Stockton-on-Tees, Peterborough ON, Guadalajara ES, Salamanca MX, ...), and the held-out list dropped them.
//
// Customary numeric date order (R1 allowed knowledge, spec/ports.json: "month first in the United
// States, day first in the other countries the bed names"). Canada, Sweden and Japan are in the table
// for completeness but carry no order: their everyday numeric orders (mixed, ISO year-first,
// year-first) disagree with the bed's rule, so no R1 line relies on them.
export const COUNTRIES = Object.freeze({
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', IE: 'Ireland', AU: 'Australia', DE: 'Germany', AT: 'Austria', CH: 'Switzerland',
  FR: 'France', BE: 'Belgium', ES: 'Spain', MX: 'Mexico', IT: 'Italy', NL: 'Netherlands', JP: 'Japan', SE: 'Sweden', DK: 'Denmark', NO: 'Norway',
});
export const COUNTRY_ORDER = Object.freeze({
  US: 'mdy', GB: 'dmy', IE: 'dmy', AU: 'dmy', DE: 'dmy', AT: 'dmy', CH: 'dmy', FR: 'dmy', BE: 'dmy', ES: 'dmy', MX: 'dmy', IT: 'dmy', NL: 'dmy', DK: 'dmy', NO: 'dmy',
  CA: null, JP: null, SE: null,
});

const TABLE = {
  US: `New York; Los Angeles; Chicago; Houston; Phoenix; Philadelphia; San Antonio; San Diego; Dallas; San Jose; Austin; Jacksonville; Fort Worth; Columbus; Charlotte; Indianapolis;
    San Francisco; Seattle; Denver; Washington; Boston; El Paso; Nashville; Detroit; Oklahoma City; Portland; Las Vegas; Memphis; Louisville; Baltimore; Milwaukee; Albuquerque; Tucson;
    Fresno; Sacramento; Kansas City; Mesa; Atlanta; Omaha; Colorado Springs; Raleigh; Miami; Long Beach; Virginia Beach; Oakland; Minneapolis; Tulsa; Tampa; New Orleans; Wichita;
    Cleveland; Bakersfield; Honolulu; Anaheim; Aurora; Santa Ana; Riverside; Corpus Christi; Lexington; Stockton; Henderson; Saint Paul; Cincinnati; St. Louis; Pittsburgh; Greensboro;
    Anchorage; Plano; Orlando; Irvine; Newark; Durham; Toledo; Fort Wayne; St. Petersburg; Laredo; Jersey City; Chandler; Madison; Lubbock; Scottsdale; Reno; Buffalo; Gilbert;
    Glendale; Winston-Salem; Chesapeake; Norfolk; Fremont; Garland; Irving; Hialeah; Richmond; Boise; Spokane; Baton Rouge; Des Moines; Tacoma; San Bernardino; Modesto; Fontana;
    Birmingham; Rochester; Salt Lake City; Providence; Knoxville; Chattanooga; Little Rock; Dayton; Akron; Syracuse; Grand Rapids; Huntsville; Montgomery; Mobile; Savannah; Charleston;
    Jackson; Springfield; Greenville; Columbia; Worcester; Hartford; New Haven; Albany; Burlington; Manchester; Cambridge; Oxford; Aberdeen; Lincoln; Plymouth; Salem; Athens; Paris; Vienna;
    Berlin; Valencia; Hanover; Brighton; Bristol; Chester; York; Reading; Bath; Newport; Bangor; Salisbury; Perth; Dover; Alexandria; Hamilton; Windsor; Victoria; Kingston; Cordoba; Leon; Merida; Portsmouth; Norwich; Parma; Hobart; Rotterdam; Derby; Coventry; Southampton; Waterford`,
  CA: `Toronto; Montreal; Vancouver; Calgary; Edmonton; Ottawa; Winnipeg; Quebec City; Hamilton; Kitchener; London; Victoria; Halifax; Oshawa; Windsor; Saskatoon; Regina; St. John's;
    Kelowna; Barrie; Sherbrooke; Guelph; Kingston; Moncton; Thunder Bay; Cambridge; Richmond; Burlington; Peterborough`,
  GB: `London; Manchester; Birmingham; Leeds; Glasgow; Liverpool; Bristol; Sheffield; Edinburgh; Cardiff; Belfast; Nottingham; Leicester; Southampton; Newcastle; Aberdeen; Brighton; Plymouth;
    Reading; Coventry; Swansea; Oxford; Cambridge; Norwich; Exeter; York; Bath; Derby; Hull; Sunderland; Wolverhampton; Portsmouth; Stoke-on-Trent; Dundee; Inverness; Milton Keynes; Luton;
    Ipswich; Middlesbrough; Blackpool; Bournemouth; Peterborough; Gloucester; Lancaster; Preston; Stirling; Perth; Bangor; Newport; Colchester; Chelmsford; Warrington; Carlisle; Durham;
    Lincoln; Wakefield; Huddersfield; Bradford; Salford; Doncaster; Rotherham; Northampton; Worcester; Hereford; Canterbury; Maidstone; Guildford; Basingstoke; Swindon; Salisbury; Winchester;
    Taunton; Truro; Falmouth; Cheltenham; Harrogate; Chester; Wrexham; Aberystwyth; Portland; Rochester; Richmond; Windsor; Boston; Dover; Hamilton; Newark; Irvine; Stockton; Norfolk`,
  IE: `Dublin; Cork; Limerick; Galway; Waterford; Kilkenny; Sligo; Drogheda; Dundalk; Athlone; Tralee; Ennis; Wexford; Carlow; Navan; Letterkenny; Killarney; Swords; Bray; Naas`,
  AU: `Sydney; Melbourne; Brisbane; Perth; Adelaide; Canberra; Hobart; Darwin; Gold Coast; Newcastle; Wollongong; Geelong; Townsville; Cairns; Toowoomba; Ballarat; Bendigo; Launceston;
    Mackay; Rockhampton; Bunbury; Albury; Wagga Wagga; Dubbo; Mildura; Alice Springs; Fremantle; Albany; Brighton; Salisbury; Richmond; Victoria; Hamilton`,
  DE: `Berlin; Hamburg; Munich; Cologne; Frankfurt; Stuttgart; Düsseldorf; Leipzig; Dortmund; Essen; Bremen; Dresden; Hanover; Nuremberg; Duisburg; Bochum; Wuppertal; Bielefeld; Bonn; Münster;
    Karlsruhe; Mannheim; Augsburg; Wiesbaden; Gelsenkirchen; Aachen; Kiel; Chemnitz; Halle; Magdeburg; Freiburg; Krefeld; Lübeck; Mainz; Erfurt; Rostock; Kassel; Potsdam; Saarbrücken;
    Heidelberg; Regensburg; Würzburg; Ulm; Göttingen; Paderborn; Osnabrück; Oldenburg; Trier; Jena; Ingolstadt; Bamberg; Konstanz; Passau; Hildesheim; Darmstadt; Bayreuth; Koblenz`,
  AT: `Vienna; Graz; Linz; Salzburg; Innsbruck; Klagenfurt; Villach; Wels; St. Pölten; Dornbirn; Steyr; Wiener Neustadt; Feldkirch; Bregenz; Leoben; Krems`,
  CH: `Zurich; Geneva; Basel; Lausanne; Bern; Winterthur; Lucerne; St. Gallen; Lugano; Biel; Thun; Fribourg; Schaffhausen; Chur; Neuchâtel; Sion; Zug; Aarau; Baden; Montreux; Locarno; Freiburg`,
  FR: `Paris; Marseille; Lyon; Toulouse; Nice; Nantes; Strasbourg; Montpellier; Bordeaux; Lille; Rennes; Reims; Le Havre; Saint-Étienne; Toulon; Grenoble; Dijon; Angers; Nîmes; Villeurbanne;
    Clermont-Ferrand; Le Mans; Aix-en-Provence; Brest; Tours; Amiens; Limoges; Annecy; Perpignan; Metz; Besançon; Orléans; Rouen; Mulhouse; Caen; Nancy; Avignon; Poitiers; La Rochelle;
    Pau; Calais; Dunkirk; Cannes; Ajaccio`,
  BE: `Brussels; Antwerp; Ghent; Charleroi; Liège; Bruges; Namur; Leuven; Mons; Mechelen; Aalst; Kortrijk; Hasselt; Ostend; Genk; Tournai; Verviers; Ypres; Arlon`,
  ES: `Madrid; Barcelona; Valencia; Seville; Zaragoza; Málaga; Murcia; Palma; Las Palmas; Bilbao; Alicante; Córdoba; Valladolid; Vigo; Gijón; Granada; A Coruña; Vitoria; Elche; Oviedo;
    Badalona; Cartagena; Terrassa; Jerez de la Frontera; Sabadell; Santa Cruz de Tenerife; Pamplona; Almería; San Sebastián; Burgos; Santander; Castellón; Albacete; Logroño; Badajoz;
    Salamanca; Huelva; Lleida; Tarragona; León; Cádiz; Jaén; Girona; Toledo; Segovia; Mérida; Guadalajara`,
  MX: `Mexico City; Guadalajara; Monterrey; Puebla; Tijuana; León; Juárez; Zapopan; Mérida; Cancún; Querétaro; Chihuahua; Aguascalientes; Morelia; Saltillo; Hermosillo; Culiacán; Toluca;
    Acapulco; Veracruz; Oaxaca; Tampico; Durango; Mazatlán; Cuernavaca; Villahermosa; Tuxtla Gutiérrez; Reynosa; Xalapa; San Luis Potosí; Torreón; Mexicali; Pachuca; Campeche;
    Zacatecas; Tlaxcala; Colima; Tepic; Ensenada; Salamanca`,
  IT: `Rome; Milan; Naples; Turin; Palermo; Genoa; Bologna; Florence; Bari; Catania; Venice; Verona; Messina; Padua; Trieste; Brescia; Parma; Taranto; Prato; Modena; Reggio Calabria;
    Reggio Emilia; Perugia; Livorno; Ravenna; Cagliari; Foggia; Rimini; Salerno; Ferrara; Sassari; Latina; Monza; Bergamo; Pescara; Trento; Vicenza; Terni; Bolzano; Novara; Piacenza;
    Ancona; Udine; Arezzo; Lecce; Pisa; Siena; Lucca; Como; Cremona; Mantua; Pavia; Treviso; Syracuse`,
  NL: `Amsterdam; Rotterdam; The Hague; Utrecht; Eindhoven; Groningen; Tilburg; Almere; Breda; Nijmegen; Apeldoorn; Haarlem; Arnhem; Enschede; Amersfoort; Zaanstad; 's-Hertogenbosch;
    Zwolle; Leiden; Maastricht; Dordrecht; Delft; Alkmaar; Leeuwarden; Deventer; Venlo; Heerlen; Hilversum; Gouda; Emmen; Bergen`,
  JP: `Tokyo; Yokohama; Osaka; Nagoya; Sapporo; Fukuoka; Kobe; Kyoto; Kawasaki; Saitama; Hiroshima; Sendai; Kitakyushu; Chiba; Niigata; Hamamatsu; Kumamoto; Sagamihara; Okayama; Shizuoka;
    Kagoshima; Funabashi; Matsuyama; Nagasaki; Kanazawa; Nara; Naha; Takamatsu; Toyama; Gifu`,
  SE: `Stockholm; Gothenburg; Malmö; Uppsala; Västerås; Örebro; Linköping; Helsingborg; Jönköping; Norrköping; Lund; Umeå; Gävle; Borås; Södertälje; Eskilstuna; Karlstad; Täby; Växjö;
    Halmstad; Luleå; Sundsvall; Östersund; Kiruna`,
  DK: `Copenhagen; Aarhus; Odense; Aalborg; Esbjerg; Randers; Kolding; Horsens; Vejle; Roskilde; Herning; Silkeborg; Næstved; Fredericia; Viborg; Køge; Holstebro; Slagelse; Hillerød; Svendborg`,
  NO: `Oslo; Bergen; Trondheim; Stavanger; Drammen; Fredrikstad; Kristiansand; Sandnes; Tromsø; Sarpsborg; Skien; Ålesund; Sandefjord; Haugesund; Tønsberg; Moss; Porsgrunn; Bodø; Arendal;
    Hamar; Larvik; Halden; Lillehammer; Molde; Harstad; Gjøvik`,
};

export const GAZETTEER = Object.freeze(Object.entries(TABLE).flatMap(([cc, names]) =>
  names.split(';').map(s => s.trim()).filter(Boolean).map(city => Object.freeze([city, cc]))));

const INDEX = new Map();
const keyOf = city => String(city).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
for (const [city, cc] of GAZETTEER) {
  const k = keyOf(city);
  const set = INDEX.get(k) ?? new Set(); set.add(cc); INDEX.set(k, set);
}
// Every country the table gives a name (sorted); [] for an unknown name.
export const lookup = city => [...(INDEX.get(keyOf(city)) ?? [])].sort();
export const ambiguousNames = () => [...INDEX.entries()].filter(([, s]) => s.size > 1).map(([k]) => k).sort();
