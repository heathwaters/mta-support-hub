export type UstaSection = {
  id: string;
  displayName: string;
  aliases: string[];
  states: string[];
  titleFilter?: RegExp;
};

export const USTA_SECTIONS: UstaSection[] = [
  {
    id: "caribbean",
    displayName: "USTA Caribbean",
    aliases: ["caribbean", "usta caribbean"],
    states: ["PR", "VI"],
  },
  {
    id: "eastern",
    displayName: "USTA Eastern",
    aliases: ["eastern", "usta eastern"],
    states: ["NY"],
  },
  {
    id: "florida",
    displayName: "USTA Florida",
    aliases: ["florida", "usta florida", "fl section"],
    states: ["FL"],
  },
  {
    id: "hawaii-pacific",
    displayName: "USTA Hawaii Pacific",
    aliases: ["hawaii pacific", "hawaii", "usta hawaii", "usta hawaii pacific", "pacific"],
    states: ["HI", "GU"],
  },
  {
    id: "intermountain",
    displayName: "USTA Intermountain",
    aliases: ["intermountain", "usta intermountain"],
    states: ["CO", "ID", "MT", "NV", "UT", "WY"],
  },
  {
    id: "mid-atlantic",
    displayName: "USTA Mid-Atlantic",
    aliases: ["mid-atlantic", "mid atlantic", "usta mid-atlantic", "usta mid atlantic"],
    states: ["DC", "MD", "VA", "WV"],
  },
  {
    id: "middle-states",
    displayName: "USTA Middle States",
    aliases: ["middle states", "usta middle states"],
    states: ["PA", "DE", "NJ"],
  },
  {
    id: "midwest",
    displayName: "USTA Midwest",
    aliases: ["midwest", "usta midwest"],
    states: ["IL", "IN", "MI", "OH", "WI"],
  },
  {
    id: "missouri-valley",
    displayName: "USTA Missouri Valley",
    aliases: ["missouri valley", "usta missouri valley", "movalley"],
    states: ["AR", "IA", "KS", "MO", "NE", "OK"],
  },
  {
    id: "new-england",
    displayName: "USTA New England",
    aliases: ["new england", "usta new england"],
    states: ["CT", "MA", "ME", "NH", "RI", "VT"],
  },
  {
    id: "northern",
    displayName: "USTA Northern",
    aliases: ["northern", "usta northern"],
    states: ["MN", "ND", "SD"],
  },
  {
    id: "norcal",
    displayName: "USTA Northern California",
    aliases: ["norcal", "nor cal", "northern california", "usta norcal", "usta northern california"],
    states: ["CA"],
    titleFilter: /norcal|northern california/i,
  },
  {
    id: "pacific-northwest",
    displayName: "USTA Pacific Northwest",
    aliases: ["pacific northwest", "pnw", "usta pacific northwest", "usta pnw"],
    states: ["AK", "OR", "WA"],
  },
  {
    id: "southern",
    displayName: "USTA Southern",
    aliases: ["southern", "usta southern"],
    states: ["AL", "GA", "KY", "LA", "MS", "NC", "SC", "TN"],
  },
  {
    id: "socal",
    displayName: "USTA Southern California",
    aliases: ["socal", "so cal", "southern california", "usta socal", "usta southern california"],
    states: ["CA"],
    titleFilter: /socal|southern california/i,
  },
  {
    id: "southwest",
    displayName: "USTA Southwest",
    aliases: ["southwest", "usta southwest"],
    states: ["AZ", "NM"],
  },
  {
    id: "texas",
    displayName: "USTA Texas",
    aliases: ["texas", "usta texas", "tx section"],
    states: ["TX"],
  },
];

const BY_ALIAS = new Map<string, UstaSection>();
for (const section of USTA_SECTIONS) {
  for (const alias of section.aliases) {
    BY_ALIAS.set(alias.toLowerCase(), section);
  }
}

export function resolveSection(input: string): UstaSection | null {
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return BY_ALIAS.get(key) ?? null;
}
