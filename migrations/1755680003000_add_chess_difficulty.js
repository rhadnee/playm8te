/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.addColumn("companions", {
    chess_difficulty: {
      type: "text",
      notNull: true,
      default: "INTERMEDIATE",
      check: "chess_difficulty IN ('BEGINNER','INTERMEDIATE','ADVANCED','EXPERT')",
    },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn("companions", "chess_difficulty");
};
