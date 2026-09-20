// Approximate geographic centroids for the states in the demo dataset, used
// only to place state-level markers on the Public Portal's read-only map.
// These are standard public-geography reference points, not derived from
// any PHC record — the public map never touches facility-level coordinates.
export const STATE_CENTROIDS: Record<string, [number, number]> = {
  Maharashtra: [19.75, 75.71],
  "Uttar Pradesh": [26.85, 80.91],
  Bihar: [25.1, 85.31],
  Rajasthan: [27.02, 74.22],
  "Tamil Nadu": [11.13, 78.66],
  Kerala: [10.85, 76.27],
};
