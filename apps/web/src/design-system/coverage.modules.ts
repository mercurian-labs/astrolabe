const mercurianModules = import.meta.glob("../components/mercurian/*.tsx");
const uiModules = import.meta.glob("../components/ui/*.tsx");

export const MERCURIAN_MODULE_PATHS = Object.keys(mercurianModules)
  .filter((path) => !/\.(?:test|stories|catalog)\.tsx$/.test(path))
  .map((globKey) => `src/${globKey.replace(/^\.\.\//, "")}`)
  .sort();

export const UI_MODULE_PATHS = Object.keys(uiModules)
  .filter((path) => !path.endsWith(".test.tsx"))
  .map((globKey) => `src/${globKey.replace(/^\.\.\//, "")}`)
  .sort();
