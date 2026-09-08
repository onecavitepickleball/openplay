window.TOURNAMENT_CONFIG = {
  appName: "Matchday",
  storageKey: "matchday.ocpc-rally-rebels.2026",
  firebaseEventId: "ocpc-rally-rebels-dual-meet-2026",
  brand: {
    organizer: "One Cavite Pickleball Club",
    shortName: "OCPC",
    logo: "../assets/logo.png",
    primary: "#005E89",
    primaryDark: "#003F5E",
    accent: "#4FB6FF",
    highlight: "#B6FF3C",
    gold: "#FFC24B"
  },
  event: {
    name: "OCPC x Rally Rebels Club Dual Meet",
    date: "2026-09-19",
    displayDate: "September 19, 2026",
    venue: "Rally District PH",
    location: "Kawit, Cavite",
    startTime: "10:00 AM",
    endTime: "5:00 PM",
    courts: 5,
    slotMinutes: 15,
    roundRobinStartMinutes: 600,
    roundRobinWaves: 19
  },
  clubs: [
    { id: "ocpc", name: "One Cavite Pickleball Club", short: "OCPC", pairPrefix: "O" },
    { id: "rebels", name: "Rally Rebels Club", short: "Rally Rebels", pairPrefix: "R" }
  ],
  categories: ["Novice", "Low Intermediate", "High Intermediate"],
  pairsPerCategory: {
    "Novice": 6,
    "Low Intermediate": 7,
    "High Intermediate": 6
  },
  scoring: {
    type: "Side-out scoring",
    target: 11,
    hardCap: 11,
    note: "Side-out scoring to 11, win by 2. At 10-10, play one sudden-death point to decide the match.",
    warningSeconds: 540,
    dangerSeconds: 840,
    targetSeconds: 900
  }
};
