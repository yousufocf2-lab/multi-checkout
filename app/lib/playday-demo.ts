// Sample catalogue for the Playday theme preview (toys and games). Shown only in the theme preview; never sold.
const U = (id: string, w = 1000, h?: number) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}${h ? `&h=${h}` : ""}&q=80`;
export const playImg = U;

export type PlayDemo = {
  handle: string; title: string; category: string; type: string; price: number; compare: number;
  colours: [string, string][]; extra: string[]; ages: string[];
  badge: string; feature: string; chips: string[]; subtitle: string; rating: number; count: number;
  usp: string[]; specs: [string, string][];
};

export const PLAY_PRODUCTS: PlayDemo[] = [
  { handle: "playday-rainbow-stacker", title: "Rainbow Stacker Tower", category: "baby-toddler", type: "Stacking toy", price: 89900, compare: 119900,
    colours: [["Rainbow", "photo-1618842676088-c4d48a6a7c9d"], ["Natural wood", "photo-1774464593838-85b320eb7453"]], extra: ["photo-1545558014-8692077e9b5c"], ages: ["0-2 years"],
    badge: "Bestseller", feature: "First toy", chips: ["Wooden", "Non-toxic paint", "Motor skills"], subtitle: "Seven chunky rings that teach colours, sizes and steady hands", rating: 4.8, count: 1260,
    usp: ["Smooth-sanded, rounded edges", "Water-based, child-safe paints", "Builds hand–eye coordination", "Rings big enough to be safe for little mouths"],
    specs: [["Age", "12 months and up"], ["Material", "Sustainable wood"], ["Pieces", "7 rings + base"], ["Size", "18 cm tall"], ["Care", "Wipe with a damp cloth"]] },
  { handle: "playday-builder-bricks-500", title: "Builder Bricks · 500 pieces", category: "building", type: "Building set", price: 149900, compare: 199900,
    colours: [["Classic colours", "photo-1587654780291-39c9404d746b"], ["Pastel", "photo-1575470522418-b88b692b8084"]], extra: ["photo-1633469924738-52101af51d87", "photo-1772920909185-05b854e3858f"], ages: ["6-8 years", "9-12 years"],
    badge: "New in", feature: "500 pcs", chips: ["500 pieces", "Idea booklet", "Storage tub"], subtitle: "A big tub of bricks with 40 build ideas to get started", rating: 4.7, count: 845,
    usp: ["500 bricks in 14 colours", "40-idea build booklet", "Fits other leading brick brands", "Comes in a resealable storage tub"],
    specs: [["Age", "6 years and up"], ["Pieces", "500"], ["Material", "BPA-free ABS"], ["In the box", "Bricks, 2 base plates, booklet, tub"]] },
  { handle: "playday-honey-bear", title: "Honey the Cuddle Bear", category: "plush", type: "Soft toy", price: 69900, compare: 99900,
    colours: [["Honey brown", "photo-1602734846297-9299fc2d4703"], ["Cream", "photo-1761402744583-7b2195f9c14a"]], extra: ["photo-1556012018-50c5c0da73bf"], ages: ["0-2 years", "3-5 years"],
    badge: "Gift pick", feature: "Super soft", chips: ["Super soft", "Washable", "35 cm"], subtitle: "A huggable friend with a bow tie and a big, kind heart", rating: 4.9, count: 2140,
    usp: ["Extra-soft plush, safe stitched eyes", "Machine washable on gentle", "Hypoallergenic filling", "A sweet name tag to fill in"],
    specs: [["Age", "All ages"], ["Height", "35 cm"], ["Fabric", "Soft polyester plush"], ["Care", "Gentle machine wash"]] },
  { handle: "playday-zoom-racers", title: "Zoom Racers · Set of 5", category: "vehicles", type: "Toy cars", price: 79900, compare: 109900,
    colours: [["Racing mix", "photo-1560859251-d563a49c5e4a"], ["City mix", "photo-1725297952113-36be1c7cefb4"]], extra: ["photo-1532330393533-443990a51d10"], ages: ["3-5 years", "6-8 years"],
    badge: "Hot deal", feature: "Pull-back", chips: ["Pull-back motor", "Die-cast", "5 cars"], subtitle: "Five pull-back racers built to zoom across any floor", rating: 4.6, count: 980,
    usp: ["Pull back and let go – no batteries", "Sturdy die-cast bodies", "Rubber tyres that grip the floor", "Perfect for races with friends"],
    specs: [["Age", "3 years and up"], ["Pieces", "5 cars"], ["Material", "Die-cast metal + plastic"], ["Size", "8 cm each"]] },
  { handle: "playday-forest-puzzle", title: "Forest Friends Floor Puzzle", category: "puzzles", type: "Jigsaw puzzle", price: 59900, compare: 79900,
    colours: [["Forest", "photo-1574492909706-09f2b2f0d909"], ["Under the sea", "photo-1583938001302-501eb68d92cf"]], extra: ["photo-1588591795084-1770cb3be374"], ages: ["3-5 years", "6-8 years"],
    badge: "", feature: "48 pieces", chips: ["48 big pieces", "Poster inside", "Recycled board"], subtitle: "A giant 48-piece floor puzzle full of animals to find", rating: 4.7, count: 512,
    usp: ["Big, thick pieces for small hands", "Finished size 60 × 40 cm", "Spot-the-animal poster included", "Printed on recycled board"],
    specs: [["Age", "4 years and up"], ["Pieces", "48"], ["Finished size", "60 × 40 cm"], ["Material", "Recycled board"]] },
  { handle: "playday-little-artist-kit", title: "Little Artist Craft Kit", category: "arts-crafts", type: "Craft kit", price: 99900, compare: 129900,
    colours: [["Bright box", "photo-1453749024858-4bca89bd9edc"], ["Pastel box", "photo-1541535193313-a132e126fb1c"]], extra: ["photo-1651346845985-8ebabdcbb0f2"], ages: ["3-5 years", "6-8 years"],
    badge: "Bestseller", feature: "120 pcs", chips: ["Washable colours", "120 pieces", "Carry case"], subtitle: "Crayons, pencils, stickers and paper in a take-anywhere case", rating: 4.8, count: 1530,
    usp: ["Washable crayons and markers", "120 pieces in one case", "Sticker sheets and drawing pad", "Handle for on-the-go creativity"],
    specs: [["Age", "3 years and up"], ["Pieces", "120"], ["In the box", "Crayons, pencils, markers, stickers, pad"]] },
  { handle: "playday-wooden-train", title: "Alphabet Express Train", category: "baby-toddler", type: "Pull-along toy", price: 129900, compare: 159900,
    colours: [["Rainbow", "photo-1769072385024-c962e061c523"], ["Natural wood", "photo-1505003098838-83ce5356c228"]], extra: ["photo-1758790015863-4f9798bb818f"], ages: ["0-2 years", "3-5 years"],
    badge: "New in", feature: "26 letters", chips: ["Wooden", "Pull-along", "ABC learning"], subtitle: "A chuffing pull-along train that spells out the alphabet", rating: 4.8, count: 430,
    usp: ["26 letter blocks to stack and spell", "Magnetic couplings", "Pull cord for first walkers", "Child-safe water-based paints"],
    specs: [["Age", "18 months and up"], ["Length", "1.1 m when joined"], ["Material", "Wood"], ["Pieces", "26 letters + engine"]] },
  { handle: "playday-family-game-night", title: "Family Game Night Board Game", category: "games", type: "Board game", price: 89900, compare: 119900,
    colours: [["Classic", "photo-1629760946220-5693ee4c46ac"], ["Travel size", "photo-1611996575749-79a3a250f948"]], extra: ["photo-1642056446796-8c7d1dcb630b"], ages: ["6-8 years", "9-12 years", "12+ years"],
    badge: "", feature: "2–6 players", chips: ["2–6 players", "20 min games", "Easy rules"], subtitle: "Race, roll and laugh – a quick game the whole family can learn in minutes", rating: 4.6, count: 690,
    usp: ["Learn in 5 minutes", "2 to 6 players", "About 20 minutes a game", "Sturdy board and chunky tokens"],
    specs: [["Age", "6 years and up"], ["Players", "2–6"], ["Play time", "20 minutes"]] },
  { handle: "playday-sky-kite", title: "Sky Dancer Rainbow Kite", category: "outdoor", type: "Outdoor toy", price: 49900, compare: 69900,
    colours: [["Rainbow", "photo-1720990779375-d98f2fd3765a"], ["Sunset", "photo-1637877658493-81195a0e2359"]], extra: ["photo-1768637067642-2854357e57ae"], ages: ["6-8 years", "9-12 years"],
    badge: "Summer pick", feature: "Easy flyer", chips: ["Easy to fly", "Ripstop fabric", "30 m line"], subtitle: "A light, easy-flying kite for breezy days in the park", rating: 4.5, count: 340,
    usp: ["Flies in light wind", "Tear-resistant ripstop fabric", "30 m line on a comfy handle", "Folds into a carry bag"],
    specs: [["Age", "5 years and up"], ["Wingspan", "90 cm"], ["Line", "30 m"]] },
  { handle: "playday-xylophone", title: "Tiny Tunes Xylophone", category: "baby-toddler", type: "Musical toy", price: 74900, compare: 94900,
    colours: [["Rainbow", "photo-1504484656217-38f8ffc617f9"], ["Pastel", "photo-1545558014-8692077e9b5c"]], extra: ["photo-1485460535564-844461f37f77"], ages: ["0-2 years", "3-5 years"],
    badge: "", feature: "8 notes", chips: ["8 tuned notes", "2 mallets", "Song cards"], subtitle: "Eight tuned notes and colour-coded song cards for first melodies", rating: 4.7, count: 610,
    usp: ["Properly tuned metal keys", "Colour-coded song cards", "Two rounded mallets", "Sturdy wooden frame"],
    specs: [["Age", "12 months and up"], ["Keys", "8"], ["Material", "Wood and metal"]] },
  { handle: "playday-plush-pals", title: "Plush Pals Gift Box", category: "plush", type: "Soft toy set", price: 119900, compare: 149900,
    colours: [["Forest friends", "photo-1549501602-52168bb8f653"], ["Bear family", "photo-1530325553241-4f6e7690cf36"]], extra: ["photo-1596068587619-e4b11c7a3488"], ages: ["0-2 years", "3-5 years", "6-8 years"],
    badge: "Gift pick", feature: "Gift boxed", chips: ["Set of 3", "Gift boxed", "Washable"], subtitle: "Three snuggly friends in a ready-to-gift box", rating: 4.8, count: 720,
    usp: ["Three soft friends in one box", "Gift box with ribbon", "Washable plush", "Safe stitched details"],
    specs: [["Age", "All ages"], ["Pieces", "3"], ["Height", "20–25 cm"]] },
  { handle: "playday-stem-blocks", title: "Shape & Sort STEM Blocks", category: "building", type: "Learning set", price: 109900, compare: 139900,
    colours: [["Bright", "photo-1568828668638-b1b4014d91a2"], ["Basket set", "photo-1777351396220-9a3801de44df"]], extra: ["photo-1484820540004-14229fe36ca4"], ages: ["3-5 years", "6-8 years"],
    badge: "New in", feature: "60 blocks", chips: ["60 blocks", "Activity cards", "Wooden"], subtitle: "Sixty wooden shapes with challenge cards for tiny engineers", rating: 4.6, count: 285,
    usp: ["60 wooden blocks in 8 shapes", "24 picture challenge cards", "Cotton storage bag", "Grows with your child"],
    specs: [["Age", "3 years and up"], ["Pieces", "60 blocks + 24 cards"], ["Material", "Wood"]] },
];

export const PLAY_CATEGORIES = [
  { handle: "building", title: "Build & create", text: "Bricks, blocks and big ideas", image: "photo-1587654780291-39c9404d746b" },
  { handle: "plush", title: "Soft friends", text: "Bears, bunnies and best buddies", image: "photo-1602734846297-9299fc2d4703" },
  { handle: "puzzles", title: "Puzzles", text: "Piece by happy piece", image: "photo-1574492909706-09f2b2f0d909" },
  { handle: "vehicles", title: "Cars & trains", text: "Ready, steady, zoom", image: "photo-1560859251-d563a49c5e4a" },
  { handle: "arts-crafts", title: "Arts & crafts", text: "Colour outside the lines", image: "photo-1453749024858-4bca89bd9edc" },
  { handle: "baby-toddler", title: "Baby & toddler", text: "First toys, first giggles", image: "photo-1618842676088-c4d48a6a7c9d" },
  { handle: "games", title: "Games night", text: "Roll, race and laugh", image: "photo-1629760946220-5693ee4c46ac" },
  { handle: "outdoor", title: "Outdoor play", text: "Fresh air adventures", image: "photo-1720990779375-d98f2fd3765a" },
];

export const PLAY_FAQS = [
  { q: "Is this toy safe for my child's age?", a: "Every toy shows a recommended age. Toys for under-3s have no small parts and use child-safe, non-toxic paints." },
  { q: "Can I add a gift message?", a: "Yes – add a note at checkout and we'll wrap it with a handwritten card at no extra cost." },
  { q: "How fast is delivery?", a: "Most orders ship within 24 hours and arrive in 2–5 working days across India." },
  { q: "What if my child doesn't like it?", a: "Unopened toys can be returned within 7 days for a full refund." },
];
