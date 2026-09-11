/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.addColumn("matches", {
    stats_recorded_at: { type: "timestamptz" },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("matches", "stats_recorded_at");
};
