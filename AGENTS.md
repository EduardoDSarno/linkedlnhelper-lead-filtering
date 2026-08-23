# Repository instructions

## Constants and comments

- Avoid magic numbers and duplicated configuration values in both executable
  code and comments.
- Define meaningful named constants for behavioral limits, defaults, delays,
  retry counts, batch sizes, concurrency limits, and similar values.
- Comments must explain intent or relationships without repeating the current
  numeric value of a constant. Prefer wording such as "uses the configured
  batch-size limit" over "uses batches of 10."
- When a numeric value is essential to documentation, generate it from the
  configuration or explicitly keep the documentation synchronized whenever
  the related constant changes.
- During reviews, treat a numeric value duplicated between code and a comment
  as maintainability drift and replace the duplicated value with a reference
  to the named concept.

## Function documentation

- Add a TSDoc-style documentation comment (`/** ... */`) immediately above
  every function and method, including internal helper functions.
- Start with a concise explanation of the function's responsibility and why it
  exists; do not merely restate its name or implementation line by line.
- Keep documentation synchronized with the implementation and follow the
  repository rule against duplicating configurable numeric values in comments.
- Just add The '@' parameters when nescessary Because most of the time they are explicit
  in the function