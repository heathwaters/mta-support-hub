/**
 * Shared MTA enum label maps.
 *
 * `MTA_TYPE_LABELS` translates the numeric `reguser_type` column into a
 * human-readable role name used in API responses across mta/search,
 * mta/account, and mta/player-search. Keep keys in sync with the
 * canonical MTA CMS user type codes.
 */
export const MTA_TYPE_LABELS: Record<number, string> = {
  1: "Player",
  2: "Parent",
  3: "Tournament Director",
  4: "Coach",
  5: "Club Admin",
  6: "Section Admin",
  7: "District Admin",
  10: "Super Admin",
};

/** Default label when `reguser_type` does not match a known code. */
export const MTA_TYPE_LABEL_DEFAULT = "Player";
