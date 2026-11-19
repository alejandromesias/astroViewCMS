// Tells whether a change to a TypeScript file touches only types (WORKPLAN 2.1l). A file's statements that
// survive compilation must be the same before and after the change: then no code changed, so Stryker has no
// mutant to find in it. Pure: the caller reads both versions with git.
import ts from 'typescript';

// A statement that is erased when the file is compiled.
function isErased(statement: ts.Statement): boolean {
  if (ts.isTypeAliasDeclaration(statement)) return true;
  if (ts.isInterfaceDeclaration(statement)) return true;
  if (ts.isImportDeclaration(statement))
    return statement.importClause?.isTypeOnly === true;
  if (ts.isExportDeclaration(statement)) return statement.isTypeOnly;
  return false;
}

// The text of each statement that survives compilation, in order.
function runtimeStatements(text: string): string[] {
  const file = ts.createSourceFile(
    'changed.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  return file.statements
    .filter((statement) => !isErased(statement))
    .map((statement) => statement.getText(file));
}

/**
 * True when `after` differs from `before` only in erased statements (types, interfaces, type-only imports and exports).
 * `before` undefined is a new file, which is not a type-only change: it has to be mutated like any other.
 */
export function isTypeOnlyChange(
  before: string | undefined,
  after: string,
): boolean {
  if (before === undefined) return false;
  const old = runtimeStatements(before);
  const next = runtimeStatements(after);
  return (
    old.length === next.length &&
    old.every((text, index) => text === next[index])
  );
}
