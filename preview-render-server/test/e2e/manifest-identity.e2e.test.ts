// Bundle identity and revisions (WORKPLAN 2.0b, 2.0c): the sample-site build
// writes bundle.json, images.json and a revision per document, each in the
// shape the contract gives. The contract parsers are the check, not a cast.
import fs from 'node:fs';
import path from 'node:path';
import {
  bundleJsonSchema,
  documentRecordSchema,
  imageRecordSchema,
} from 'preview-contract';
import { PROTOCOL_VERSION } from 'preview-protocol';
import { describe, expect, inject, it } from 'vitest';

describe('the sample-site manifests of a build', () => {
  const manifest = path.join(inject('buildDir'), 'sample-site', 'manifest');
  const read = (name: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(manifest, name), 'utf8')) as unknown;

  it('writes a bundle.json the contract accepts, for the protocol this build speaks', () => {
    const bundle = bundleJsonSchema.parse(read('bundle.json'));
    expect(bundle.protocolVersion).toBe(PROTOCOL_VERSION);
    // The site sits inside the astroViewCMS git checkout, so it has a commit.
    expect(bundle.siteCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('gives every document a revision, and each testimonials entry its own', () => {
    const documents = documentRecordSchema
      .array()
      .parse(read('documents.json'));
    const testimonials = documents.filter((document) =>
      document.key.startsWith('testimonials/'),
    );
    expect(testimonials.length).toBeGreaterThan(1);
    expect(new Set(testimonials.map((d) => d.revision)).size).toBe(
      testimonials.length,
    );
  });

  it('lists the images under src/ with their hashes', () => {
    const images = imageRecordSchema.array().parse(read('images.json'));
    expect(images).toContainEqual({
      path: 'src/assets/partners/atlas.png',
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });
});
