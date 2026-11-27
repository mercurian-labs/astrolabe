/**
 * What a file tree keeps when it shows only `paths`: each of them, the folders holding them, and
 * the selected file with its folders, so narrowing the tree never hides the file that is open.
 */
export function keptTreePaths(
  paths: ReadonlyArray<string>,
  selectedPath: string | null,
): ReadonlySet<string> {
  const kept = new Set<string>();
  for (const path of selectedPath === null ? paths : [...paths, selectedPath]) {
    for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
      kept.add(path.slice(0, slash));
    }
    kept.add(path);
  }
  return kept;
}
