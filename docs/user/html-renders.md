# Visual replies

Agents can answer with a page instead of only text: a chart, table, image collage, or mockup. Diagrams of boxes and arrows are drawn as [canvases](#canvases). Ask for one ("show this as a chart", "make a collage of these screenshots") and the agent builds a self-contained HTML page, which appears in the thread above its written reply. It works with every provider, on web, desktop, and mobile.

Pages use your current theme, including custom themes, and follow light and dark mode as you switch. Scripts run inside the page, but it is sandboxed away from T3 Code and your session. Links you click in a page open in your browser. Use the expand button to open a page full screen. On web and desktop, use the zoom controls to see more detail.

Agents can place local images in a page by file path. T3 Code embeds them when the page is published, so the page keeps working after the original files move or are deleted. Deleting the thread deletes its pages.

Before publishing, agents check their work with screenshots from a small headless browser that T3 Code keeps for itself; it never uses a browser you installed. The first preview on a machine downloads it once (about 120 MB) into T3 Code's data folder, so that preview can take a minute. Browser tabs on a remote environment use the same browser, so whichever comes first downloads it. Some Linux hosts need [setup](remote-access.md#browser-host-setup) before it can start. Pages publish without it.

## Canvases

When a flow, an architecture, or a set of dependencies is easier to see than to read, an agent draws it as a canvas in the thread, with or without being asked: cards, arrows and groups, laid out for it. A card can hold text, a link, or a place in your code. Click a code card to open the file at that line.

The expand button opens the canvas in the right panel, where you can drag and scroll to pan, pinch or Ctrl-scroll to zoom, and use **Fit** to see the whole board. On the phone, tap a canvas to do the same.

Some canvases come with stories, which walk the board a step at a time. **Present**, at the foot of the board, moves to each step and shows what it says; the arrow keys, Page Up and Page Down step too, and the full-screen button gives the board the whole screen. Hover a step's number to see what it covers, or click it for its note.

**Edit**, beside the zoom buttons, opens the canvas in the right panel ready to change: move and add cards as on a [wiki canvas](wikis.md#edit-a-canvas), and write its [stories](wikis.md#edit-a-canvas). The copy in the chat stays read-only and shows your edits as you make them. Your edits save into the thread, and on its next turn the agent sees the board as you left it. The gear turns **Read-only** back on.

A canvas stays in its thread and is deleted with it, unless you keep it. **Keep**, beside the expand button or on the phone's board, lets you add a comment, then **Add to chat** puts the canvas in the composer as a chip. Say what you want done with it, invoke any skill you like, and send: the agent can save it to a wiki as it looks in the thread. On a computer, ⌘Enter or Ctrl+Enter adds it and sends. **Place in wiki** does the saving yourself: it asks for a wiki and a name, with a folder before the name if you want it in one, and saves the canvas there as it looks in the thread, in a pull request you can merge or close. Closing it discards the copy and leaves the thread's canvas alone.

A kept code card is a link to that file at a commit your remote has, so it works outside Astrolabe too. If the thread's commit isn't pushed, the link goes to the nearest commit that is, and Keep tells you the code there may differ. A card becomes plain text, naming the file and commit, if the file isn't in a pushed commit or the repository has no remote, or on a server such as Bitbucket Data Center that has no such link.

Canvases use the open JSON Canvas format.

## MCP apps

Some MCP servers return an interactive app with their tool results, following the [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) standard. When an agent calls one of those tools, the app appears in the thread in place of the tool call, on web, desktop, and mobile. Codex supports this today, for any MCP server you have configured for it; other providers show these calls as ordinary tool calls.

Apps follow your theme. An app can call tools on its own server and post a message to the thread; T3 Code asks first unless the server marks the tool as read-only, and it asks before every message. On mobile, an app also asks before opening a link, and T3 Code asks before saving a file an app offers. An app stays viewable after its agent stops, but using it needs the agent of the thread that created it running, so send a message in that thread first if the app says it is unavailable. An app that navigates away from its own page is stopped.

An app can open full screen right after you tap or click in it. On web and desktop, a tap in the app within five seconds of a click or key press elsewhere in T3 Code doesn't count, so tap it again after that. Use the button in its top corner, or press Escape outside the app, to return it to the thread. Anything else that needs your attention, such as an approval, also returns it to the thread. On mobile, full screen opens the app again in its own screen, so anything the app does not save itself starts over. An app can also keep the agent informed of what you did in it, such as a filter you picked; T3 Code sends the latest note from each app with your next message.
