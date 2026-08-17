# Settings

**Settings → Preferences** holds workspace behavior that changes how Mercurian works without
changing a repository.

## Planning model

**Planning model** under **Providers** is the workspace default that seeds new planning. Branches
follow it until their composer chooses a different provider and model; choosing **Workspace
default** there makes that branch follow this setting again. The pair is shared, but each machine
resolves it to one of its own connected provider instances.

## Background refresh

**Background refresh** controls how often Mercurian refreshes remote source-control status. Enter
the interval in seconds. The reset button restores the default for the current background-activity
profile.

Set the interval to **0** when remote status should refresh only after an explicit action such as a
push or pull. At zero, credential prompts do not fire from background refresh while the app is at
rest; source-control actions you start can still ask for credentials normally.
