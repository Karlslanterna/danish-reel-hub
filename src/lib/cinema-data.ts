export type Movie = {
  id: string;
  title: string;
  originalTitle?: string;
  runtime: number; // minutes
  genre: string[];
  year: number;
  director: string;
  rating: string;
  synopsis: string;
  poster: { a: string; b: string; c: string; d: string };
};

export type Cinema = {
  id: string;
  name: string;
  city: string;
  address: string;
  description: string;
  screens: number;
  movieIds: string[];
};

export type Showtime = {
  movieId: string;
  cinemaId: string;
  date: string; // "I dag" / "I morgen" / "Fre 13. jun"
  times: string[];
  hall: string;
};

export const movies: Movie[] = [
  {
    id: "vinterlys",
    title: "Vinterlys",
    originalTitle: "Vinterlys",
    runtime: 118,
    genre: ["Drama", "Mystery"],
    year: 2026,
    director: "Annika Holm",
    rating: "15",
    synopsis:
      "I en isoleret fyrtårnsby på Jyllands vestkyst vender en fotograf hjem for at begrave sin far — og opdager et brev, der trækker hende ind i en sandhed familien har skjult i fyrre år.",
    poster: { a: "oklch(0.62 0.14 60)", b: "oklch(0.30 0.08 250)", c: "oklch(0.22 0.03 250)", d: "oklch(0.10 0.02 250)" },
  },
  {
    id: "nordvest",
    title: "Nordvest 2",
    runtime: 104,
    genre: ["Krimi", "Thriller"],
    year: 2026,
    director: "Michael Noer",
    rating: "16",
    synopsis:
      "Casper er ude af fængslet og forsøger at lede et stille liv i en ny bydel. Men gælden følger med, og lillebroderen er allerede dybt nede i den.",
    poster: { a: "oklch(0.55 0.18 25)", b: "oklch(0.18 0.04 30)", c: "oklch(0.16 0.02 30)", d: "oklch(0.08 0.01 30)" },
  },
  {
    id: "den-store-stille",
    title: "Den Store Stille",
    runtime: 142,
    genre: ["Drama"],
    year: 2025,
    director: "Tea Lindeburg",
    rating: "11",
    synopsis:
      "En gårdmandsfamilie i 1890'ernes Vendsyssel forbereder den ældste datter på et liv, hun ikke har valgt. Et stille epos om arv, jord og det der ikke siges højt.",
    poster: { a: "oklch(0.70 0.10 90)", b: "oklch(0.35 0.06 80)", c: "oklch(0.20 0.02 80)", d: "oklch(0.10 0.01 80)" },
  },
  {
    id: "kobenhavn-by-night",
    title: "København by Night",
    runtime: 96,
    genre: ["Komedie", "Romance"],
    year: 2026,
    director: "Frederikke Aspöck",
    rating: "Tilladt",
    synopsis:
      "Tre fremmede, én nat på Nørrebro. En cykelkurer, en jazzpianist og en svensk turist krydser veje mellem Assistens og morgenfærgen.",
    poster: { a: "oklch(0.65 0.18 340)", b: "oklch(0.45 0.15 290)", c: "oklch(0.18 0.04 290)", d: "oklch(0.10 0.02 290)" },
  },
  {
    id: "havets-skygge",
    title: "Havets Skygge",
    runtime: 128,
    genre: ["Sci-Fi", "Drama"],
    year: 2026,
    director: "Ali Abbasi",
    rating: "15",
    synopsis:
      "Året er 2061. En marinbiolog opdager en intelligens dybt under Skagerrak — og bliver fanget mellem videnskab, forsvar og noget der ikke vil ses.",
    poster: { a: "oklch(0.55 0.15 200)", b: "oklch(0.30 0.10 230)", c: "oklch(0.15 0.04 230)", d: "oklch(0.08 0.02 230)" },
  },
  {
    id: "skovens-born",
    title: "Skovens Børn",
    runtime: 88,
    genre: ["Animation", "Familie"],
    year: 2025,
    director: "Esben Toft Jacobsen",
    rating: "Tilladt",
    synopsis:
      "Tre søskende flytter til mormors hus ved Rold Skov og opdager, at træerne husker alt — også de ting børnene helst vil glemme.",
    poster: { a: "oklch(0.70 0.16 140)", b: "oklch(0.40 0.10 150)", c: "oklch(0.18 0.04 150)", d: "oklch(0.10 0.02 150)" },
  },
  {
    id: "rod-jord",
    title: "Rød Jord",
    runtime: 134,
    genre: ["Historisk", "Drama"],
    year: 2025,
    director: "Nikolaj Arcel",
    rating: "15",
    synopsis:
      "En dansk officer sendt til Grønland i 1953 må vælge mellem ordren og det folk, han er kommet for at forvalte.",
    poster: { a: "oklch(0.60 0.20 20)", b: "oklch(0.25 0.10 20)", c: "oklch(0.14 0.04 20)", d: "oklch(0.08 0.02 20)" },
  },
  {
    id: "alt-hvad-vi-glemte",
    title: "Alt Hvad Vi Glemte",
    runtime: 112,
    genre: ["Drama", "Romance"],
    year: 2026,
    director: "May el-Toukhy",
    rating: "11",
    synopsis:
      "Tyve år efter gymnasiet mødes to mennesker igen på en perron i Aarhus. De har én eftermiddag før hendes tog går.",
    poster: { a: "oklch(0.72 0.10 50)", b: "oklch(0.45 0.08 40)", c: "oklch(0.20 0.03 40)", d: "oklch(0.10 0.01 40)" },
  },
  {
    id: "midnatsgaesten",
    title: "Midnatsgæsten",
    runtime: 101,
    genre: ["Gyser"],
    year: 2026,
    director: "Christian Tafdrup",
    rating: "16",
    synopsis:
      "En familie køber et sommerhus i Thy. Den første nat banker det på døren — og det stopper aldrig.",
    poster: { a: "oklch(0.40 0.18 0)", b: "oklch(0.18 0.08 0)", c: "oklch(0.10 0.03 0)", d: "oklch(0.05 0.01 0)" },
  },
  {
    id: "saa-laenge-vi-danser",
    title: "Så Længe Vi Danser",
    runtime: 124,
    genre: ["Musical", "Drama"],
    year: 2026,
    director: "Susanne Bier",
    rating: "11",
    synopsis:
      "En tidligere balletdanser åbner en danseskole i Vesterbro for unge der har mistet alt. Hun har også selv mistet noget.",
    poster: { a: "oklch(0.65 0.20 320)", b: "oklch(0.40 0.15 310)", c: "oklch(0.18 0.05 310)", d: "oklch(0.08 0.02 310)" },
  },
  {
    id: "fjordens-stemme",
    title: "Fjordens Stemme",
    runtime: 107,
    genre: ["Dokumentar"],
    year: 2025,
    director: "Jeppe Rønde",
    rating: "Tilladt",
    synopsis:
      "Et år langs Limfjorden. Fiskere, biologer og en gammel færgemand fortæller om et vand der ændrer sig hurtigere end nogen kan følge med.",
    poster: { a: "oklch(0.70 0.12 220)", b: "oklch(0.45 0.10 220)", c: "oklch(0.20 0.03 220)", d: "oklch(0.10 0.01 220)" },
  },
  {
    id: "den-sidste-vinter",
    title: "Den Sidste Vinter",
    runtime: 119,
    genre: ["Thriller", "Drama"],
    year: 2026,
    director: "Tobias Lindholm",
    rating: "15",
    synopsis:
      "På en forskningsstation i Nordgrønland forsvinder kommunikationen. Otte mennesker. Fire måneders mørke. Én der ikke skal være der.",
    poster: { a: "oklch(0.75 0.05 220)", b: "oklch(0.40 0.06 230)", c: "oklch(0.18 0.02 240)", d: "oklch(0.08 0.01 240)" },
  },
];

export const cinemas: Cinema[] = [
  {
    id: "grand-teatret",
    name: "Grand Teatret",
    city: "København",
    address: "Mikkel Bryggers Gade 8, 1460 København K",
    description:
      "Et af Københavns ældste arthouse-biografer, grundlagt 1913. Seks sale, kurateret program med fokus på europæisk og nordisk film.",
    screens: 6,
    movieIds: ["vinterlys", "den-store-stille", "alt-hvad-vi-glemte", "fjordens-stemme", "rod-jord", "saa-laenge-vi-danser"],
  },
  {
    id: "empire-bio",
    name: "Empire Bio",
    city: "København",
    address: "Guldbergsgade 29F, 2200 København N",
    description:
      "Nørrebros kvarterbiograf. Hyggelig café, tre sale og et program der spænder fra nye danske premierer til kult-genvisninger.",
    screens: 3,
    movieIds: ["nordvest", "kobenhavn-by-night", "midnatsgaesten", "saa-laenge-vi-danser", "vinterlys"],
  },
  {
    id: "oest-for-paradis",
    name: "Øst for Paradis",
    city: "Aarhus",
    address: "Paradisgade 7, 8000 Aarhus C",
    description:
      "Aarhus' kulturbiograf siden 1978. Fem sale, en café og en stædig kærlighed til film der ikke spiller andre steder.",
    screens: 5,
    movieIds: ["den-store-stille", "havets-skygge", "alt-hvad-vi-glemte", "skovens-born", "fjordens-stemme", "den-sidste-vinter"],
  },
  {
    id: "biffen-aalborg",
    name: "Biffen",
    city: "Aalborg",
    address: "Strandvejen 19, 9000 Aalborg",
    description:
      "Nordjyllands arthouse-biograf, beliggende i Nordkraft. To sale, ét stærkt kurateret blik.",
    screens: 2,
    movieIds: ["vinterlys", "rod-jord", "fjordens-stemme", "den-sidste-vinter"],
  },
  {
    id: "cafe-biografen",
    name: "Café Biografen",
    city: "Odense",
    address: "Brandts Passage 39-41, 5000 Odense C",
    description:
      "Odenses kulturbiograf i Brandts Klædefabrik. Fem sale, levende café-miljø, premierer hver torsdag.",
    screens: 5,
    movieIds: ["nordvest", "kobenhavn-by-night", "skovens-born", "midnatsgaesten", "saa-laenge-vi-danser", "havets-skygge"],
  },
];

const days = ["I dag", "I morgen", "Fre 13. jun", "Lør 14. jun", "Søn 15. jun"];
const timeSlots = [
  ["16:30", "19:00", "21:30"],
  ["17:15", "20:00"],
  ["18:45", "21:15"],
  ["15:00", "17:30", "20:00", "22:15"],
  ["19:30"],
];

export function getShowtimes(movieId: string): Showtime[] {
  const result: Showtime[] = [];
  cinemas.forEach((cinema, ci) => {
    if (!cinema.movieIds.includes(movieId)) return;
    days.forEach((day, di) => {
      const slot = timeSlots[(ci + di) % timeSlots.length];
      result.push({
        movieId,
        cinemaId: cinema.id,
        date: day,
        times: slot,
        hall: `Sal ${((ci + di) % cinema.screens) + 1}`,
      });
    });
  });
  return result;
}

export function getMovie(id: string) {
  return movies.find((m) => m.id === id);
}
export function getCinema(id: string) {
  return cinemas.find((c) => c.id === id);
}
export function getMoviesByIds(ids: string[]) {
  return ids.map(getMovie).filter((m): m is Movie => Boolean(m));
}
export function getCinemasForMovie(movieId: string) {
  return cinemas.filter((c) => c.movieIds.includes(movieId));
}

export function formatRuntime(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}t ${m}m`;
}
