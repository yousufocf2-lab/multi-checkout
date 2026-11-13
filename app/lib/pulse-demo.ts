// Sample catalogue for the Pulse theme preview (audio and wearables). Shown only in the theme preview; never sold.
const U = (id: string, w = 1000, h?: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ""}&q=80`;

export type PulseDemo = {
  handle: string; title: string; category: string; type: string; price: number; compare: number;
  colours: [string, string][]; // [colour name, image id]
  extra: string[]; // more photo ids
  badge: string; feature: string; chips: string[]; subtitle: string; rating: number; count: number;
  usp: string[]; specs: [string, string][];
};

export const PULSE_PRODUCTS: PulseDemo[] = [
  { handle: "pulse-aero-pods-x1", title: "Aero Pods X1", category: "earbuds", type: "True wireless earbuds", price: 149900, compare: 499900,
    colours: [["Midnight Black", "photo-1606220945770-b5b6c2c55bf1"], ["Ocean Blue", "photo-1606220588913-b3aacb4d2f46"]], extra: ["photo-1677346414290-d337cbc682a6"],
    badge: "New launch", feature: "32 dB ANC", chips: ["32 dB ANC", "50H playtime", "Fast charge"], subtitle: "Hybrid ANC earbuds with quad-mic calling, 50 hours of play and app control", rating: 4.7, count: 1240,
    usp: ["32 dB hybrid active noise cancellation", "Quad mic ENC for clear calls", "50 hours total playback", "10 min charge = 150 min play", "45 ms low-latency game mode", "IPX5 sweat and splash resistance"],
    specs: [["Driver", "13 mm dynamic driver"], ["Bluetooth", "5.4, dual device pairing"], ["Playback", "Up to 50 hours with case"], ["Charging", "USB Type-C, fast charge"], ["Water resistance", "IPX5"], ["In the box", "Earbuds, case, Type-C cable, extra ear tips"]] },
  { handle: "pulse-aero-pods-lite", title: "Aero Pods Lite", category: "earbuds", type: "True wireless earbuds", price: 99900, compare: 349900,
    colours: [["Graphite", "photo-1578319439584-104c94d37305"], ["Frost White", "photo-1783890848515-c0dc28b25ef2"]], extra: ["photo-1677346414290-d337cbc682a6"],
    badge: "Bestseller", feature: "ENC calls", chips: ["ENC mic", "40H playtime", "Type-C"], subtitle: "Everyday earbuds with clear ENC calls and a pocket-friendly case", rating: 4.5, count: 3820,
    usp: ["Environmental noise cancellation for calls", "40 hours total playback", "Instant pairing when you open the case", "Touch controls", "IPX4 splash resistance"],
    specs: [["Driver", "10 mm"], ["Bluetooth", "5.3"], ["Playback", "Up to 40 hours"], ["Charging", "USB Type-C"], ["Water resistance", "IPX4"]] },
  { handle: "pulse-nova-buds-pro", title: "Nova Buds Pro", category: "earbuds", type: "True wireless earbuds", price: 199900, compare: 599900,
    colours: [["Pearl White", "photo-1783890848515-c0dc28b25ef2"], ["Onyx", "photo-1606220945770-b5b6c2c55bf1"]], extra: ["photo-1590658268037-6bf12165a8df"],
    badge: "Top rated", feature: "Spatial audio", chips: ["Hybrid ANC", "Spatial audio", "Wireless charging"], subtitle: "Premium sound with spatial audio, hybrid ANC and wireless charging", rating: 4.8, count: 642,
    usp: ["Hybrid ANC up to 45 dB", "Spatial audio with head tracking", "Wireless charging case", "6-mic AI call clarity", "Multipoint connection"],
    specs: [["Driver", "11 mm + 6 mm dual drivers"], ["Bluetooth", "5.4, LDAC"], ["Playback", "Up to 42 hours"], ["Charging", "Type-C and wireless"], ["Water resistance", "IPX5"]] },
  { handle: "pulse-halo-max", title: "Halo Max Headphones", category: "headphones", type: "Over-ear headphones", price: 299900, compare: 799900,
    colours: [["Stealth Black", "photo-1505740420928-5e560c06d30e"], ["Carbon", "photo-1618366712010-f4ae9c647dcb"]], extra: ["photo-1599669454699-248893623440"],
    badge: "New launch", feature: "70H play", chips: ["40 dB ANC", "70H playtime", "40 mm drivers"], subtitle: "Over-ear ANC headphones with deep bass and soft memory-foam cushions", rating: 4.6, count: 980,
    usp: ["40 dB active noise cancellation", "70 hours of playback", "40 mm bass-boosted drivers", "Memory-foam cushions", "Foldable design with travel case"],
    specs: [["Driver", "40 mm"], ["Bluetooth", "5.3"], ["Playback", "Up to 70 hours"], ["Charging", "Type-C, 10 min = 10 hours"], ["Weight", "245 g"]] },
  { handle: "pulse-halo-air", title: "Halo Air Headphones", category: "headphones", type: "Over-ear headphones", price: 179900, compare: 499900,
    colours: [["Blush Pink", "photo-1613040809024-b4ef7ba99bc3"], ["Silver", "photo-1583394838336-acd977736f90"]], extra: ["photo-1612116454817-2b0841e30eaf"],
    badge: "Trending", feature: "Lightweight", chips: ["60H playtime", "Dual pairing", "Foldable"], subtitle: "Feather-light wireless headphones for all-day listening", rating: 4.4, count: 512,
    usp: ["Only 190 g, comfortable all day", "60 hours of playback", "Connect two devices at once", "Built-in mic for calls"],
    specs: [["Driver", "40 mm"], ["Bluetooth", "5.3"], ["Playback", "Up to 60 hours"], ["Weight", "190 g"]] },
  { handle: "pulse-watch-ultra", title: "Pulse Watch Ultra", category: "smartwatches", type: "Smartwatch", price: 249900, compare: 999900,
    colours: [["Titan Black", "photo-1579586337278-3befd40fd17a"], ["Steel Grey", "photo-1660844817855-3ecc7ef21f12"]], extra: ["photo-1461141346587-763ab02bced9"],
    badge: "New launch", feature: "AMOLED", chips: ["1.96\" AMOLED", "BT calling", "Always-on"], subtitle: "Rugged smartwatch with a bright AMOLED screen, Bluetooth calling and 100+ sports modes", rating: 4.6, count: 2105,
    usp: ["1.96\" AMOLED, 600 nits", "Bluetooth calling with dial pad", "Always-on display", "Heart rate, SpO2 and sleep tracking", "100+ sports modes", "7 days battery"],
    specs: [["Display", "1.96\" AMOLED, 410 × 502"], ["Calling", "Bluetooth calling"], ["Battery", "Up to 7 days"], ["Water resistance", "IP68"], ["Strap", "22 mm silicone"]] },
  { handle: "pulse-watch-fit", title: "Pulse Watch Fit", category: "smartwatches", type: "Smartwatch", price: 129900, compare: 699900,
    colours: [["Jet Black", "photo-1624096104992-9b4fa3a279dd"], ["Slate", "photo-1551816230-ef5deaed4a26"]], extra: ["photo-1461141346587-763ab02bced9"],
    badge: "Bestseller", feature: "HD display", chips: ["1.83\" HD", "BT calling", "IP68"], subtitle: "Slim everyday smartwatch with calling, fitness tracking and a week-long battery", rating: 4.3, count: 4310,
    usp: ["1.83\" HD display", "Bluetooth calling", "Health tracking", "IP68 water resistance", "7 days battery"],
    specs: [["Display", "1.83\" HD"], ["Battery", "Up to 7 days"], ["Water resistance", "IP68"]] },
  { handle: "pulse-boom-go", title: "Boom Go Speaker", category: "speakers", type: "Bluetooth speaker", price: 179900, compare: 499900,
    colours: [["Black", "photo-1589003077984-894e133dabab"], ["Stone Grey", "photo-1547052178-7f2c5a20c332"]], extra: ["photo-1507878566509-a0dbe19677a5"],
    badge: "Hot deal", feature: "20W sound", chips: ["20W output", "IPX6", "12H play"], subtitle: "Portable speaker with punchy 20W sound, IPX6 and RGB lights", rating: 4.5, count: 760,
    usp: ["20W stereo output", "IPX6 water resistance", "12 hours of playback", "TWS pairing for double sound"],
    specs: [["Output", "20W"], ["Bluetooth", "5.3"], ["Playback", "Up to 12 hours"], ["Water resistance", "IPX6"]] },
  { handle: "pulse-boom-max", title: "Boom Max Party Speaker", category: "speakers", type: "Bluetooth speaker", price: 349900, compare: 899900,
    colours: [["Black Red", "photo-1589001181560-a8df1800e501"], ["Graphite", "photo-1598034989845-48532781987e"]], extra: ["photo-1589003077984-894e133dabab"],
    badge: "New launch", feature: "60W bass", chips: ["60W output", "Karaoke mic in", "RGB lights"], subtitle: "Party speaker with 60W of room-filling bass and karaoke input", rating: 4.6, count: 288,
    usp: ["60W output with deep bass", "Karaoke mic input", "RGB party lights", "16 hours of playback"],
    specs: [["Output", "60W"], ["Inputs", "Bluetooth, AUX, USB, mic"], ["Playback", "Up to 16 hours"]] },
  { handle: "pulse-charge-pro-20k", title: "Charge Pro 20000 mAh", category: "power-banks", type: "Power bank", price: 119900, compare: 299900,
    colours: [["Mint", "photo-1566554738544-d962991c3fee"], ["White", "photo-1760708825913-65a50b3dc39b"]], extra: [],
    badge: "Value pick", feature: "22.5W fast", chips: ["20000 mAh", "22.5W fast", "3 outputs"], subtitle: "Slim 20000 mAh power bank with 22.5W fast charging", rating: 4.4, count: 1820,
    usp: ["20000 mAh capacity", "22.5W fast charging", "Charge 3 devices together", "Type-C input and output"],
    specs: [["Capacity", "20000 mAh"], ["Output", "22.5W max"], ["Ports", "2 × USB-A, 1 × Type-C"]] },
  { handle: "pulse-raid-gaming-headset", title: "Raid Gaming Headset", category: "gaming", type: "Gaming headset", price: 159900, compare: 399900,
    colours: [["Black", "photo-1673669231301-09baa4d7761b"], ["Shadow", "photo-1605170876472-db58e15c430e"]], extra: [],
    badge: "Gamer’s pick", feature: "45 ms latency", chips: ["45 ms latency", "RGB", "Boom mic"], subtitle: "Low-latency gaming headset with a flexible boom mic and RGB", rating: 4.5, count: 455,
    usp: ["45 ms ultra-low latency", "Flexible boom mic", "RGB lights", "50 mm drivers"],
    specs: [["Driver", "50 mm"], ["Latency", "45 ms in game mode"], ["Connection", "Bluetooth 5.3 + 3.5 mm"]] },
];

export const PULSE_CATEGORIES = [
  { handle: "earbuds", title: "True wireless", image: "photo-1606220588913-b3aacb4d2f46", text: "Earbuds for every day" },
  { handle: "headphones", title: "Headphones", image: "photo-1505740420928-5e560c06d30e", text: "Big sound, all-day comfort" },
  { handle: "smartwatches", title: "Smartwatches", image: "photo-1579586337278-3befd40fd17a", text: "Calls, health and style" },
  { handle: "speakers", title: "Speakers", image: "photo-1589003077984-894e133dabab", text: "Take the party anywhere" },
  { handle: "power-banks", title: "Power banks", image: "photo-1566554738544-d962991c3fee", text: "Never run out" },
  { handle: "gaming", title: "Gaming", image: "photo-1673669231301-09baa4d7761b", text: "Low latency, high wins" },
];

export const pulseImg = U;

export const PULSE_FAQS = [
  { q: "Does it support fast charging?", a: "Yes. A short charge gives you hours of use, and the full charge takes about 1.5 hours with a Type-C cable." },
  { q: "Is it compatible with Android and iPhone?", a: "Yes, it works with any phone, tablet or laptop that has Bluetooth." },
  { q: "What is the warranty?", a: "Every product has a 1-year warranty against manufacturing defects." },
  { q: "Can I pay cash on delivery?", a: "Yes. Cash on delivery is available on most pincodes. Prepaid orders get an extra discount." },
];
