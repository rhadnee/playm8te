/* eslint-disable camelcase */
const presets = require("../src/personalities/presets.json");

exports.up = (pgm) => {
  for (const preset of presets) {
    pgm.sql(
      `INSERT INTO companion_personalities (id, owner_id, config)
       VALUES ('${preset.id}', NULL, '${JSON.stringify(preset).replace(/'/g, "''")}'::jsonb)
       ON CONFLICT (id) DO NOTHING;`
    );
  }
};

exports.down = (pgm) => {
  const ids = presets.map((p) => `'${p.id}'`).join(",");
  pgm.sql(`DELETE FROM companion_personalities WHERE id IN (${ids}) AND owner_id IS NULL;`);
};
