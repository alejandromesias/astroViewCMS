// The wire shapes of the CMS API: the request and answer schemas of each route, and the error codes with their HTTP
// status (PHASE-2-DESIGN 5.9). A leaf package: zod is its only dependency. The editor imports this package and
// preview-protocol, and nothing else of the CMS.
export * from './answers.ts';
export * from './errors.ts';
export * from './requests.ts';
export * from './shapes.ts';
