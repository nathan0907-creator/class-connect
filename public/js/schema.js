// Response formats for the AI (JSON Schema), written exactly like Firebase's `Schema` helper produces them, so the
// AI SDK only has to be downloaded the first time the AI is actually used (see ai.js).
const node = (type, extra = {}) => ({ type, ...extra, nullable: false });

export const Schema = {
  string: () => node('string'),
  integer: () => node('integer'),
  number: () => node('number'),
  boolean: () => node('boolean'),
  array: ({ items }) => node('array', { items }),
  /** Every property is required unless listed in optionalProperties (same rule as Firebase's helper). */
  object: ({ properties, optionalProperties = [] }) => ({
    type: 'object', properties, nullable: false,
    required: Object.keys(properties).filter((k) => !optionalProperties.includes(k)),
  }),
};
