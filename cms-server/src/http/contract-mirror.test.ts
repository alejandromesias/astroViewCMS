// The contract mirrors the shapes of preview-contract and preview-protocol instead of importing them (cms-contract is a leaf,
// and preview-contract pulls in node:crypto). These type checks fail when a mirror drifts from the type it copies.
import type {
  ChangesBody,
  DocumentBody,
  OverlayBody,
  SchemaBody,
} from 'cms-contract';
import type {
  CollectionSchemaJson,
  DocumentRecord,
  RenderRequest,
} from 'preview-contract';
import type { MediaInfo } from 'preview-protocol';
import { describe, expectTypeOf, it } from 'vitest';

describe('the contract mirrors the shapes they copy', () => {
  it('mirrors the render request as the overlay answer', () => {
    expectTypeOf<OverlayBody>().toEqualTypeOf<RenderRequest>();
  });

  // The two checks below go one way only: a value the CMS builds from preview-contract's type must fit the contract's type.
  // Zod infers an optional key as `?: T | undefined`, which exactOptionalPropertyTypes reads as wider than `?: T`.
  it('mirrors a collection of schema.json in the schema answer', () => {
    expectTypeOf<CollectionSchemaJson & { name: string }>().toMatchTypeOf<
      SchemaBody['collections'][number]
    >();
  });

  it('mirrors a document record in the changes answer', () => {
    expectTypeOf<DocumentRecord>().toMatchTypeOf<
      ChangesBody['createdRecords'][number]
    >();
  });

  it('mirrors the format of a document in the document answer', () => {
    expectTypeOf<DocumentBody['format']>().toEqualTypeOf<
      DocumentRecord['format']
    >();
  });

  it('mirrors the metadata of a media entry', () => {
    expectTypeOf<
      NonNullable<OverlayBody['media']>[string]
    >().toEqualTypeOf<MediaInfo>();
  });
});
