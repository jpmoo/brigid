<p align="center"><img width="50%" alt="image" src="https://github.com/user-attachments/assets/b5bf6302-4e80-4b36-be29-2297628c8569" /></p>


A web application for writing novels and short stories that you run on your own hardware or network. Named after the Celtic
goddess of poetry.

Brigid keeps your manuscript as a structured outline rather than one long file, so
you can move a chapter without cutting and pasting twenty pages. It handles the
things a novel needs and a word processor doesn't: parts and chapters and scenes
that know what they are, formatting decided once and applied everywhere, a
canvas that lays the whole shape of the book out in front of you, compiling to a
submission manuscript, and — if you want it — a local AI that
reads the book and tells you what shape it has, maps your characters to archetypes, and lets you chat about your work.

Nothing leaves your machine or server until you're ready to compile into a Word document or a PDF. There is no account with anyone, no subscription,
and no company that can change the terms later. If you use the AI features, the
model runs on hardware you control too.

**This is a vibe-coded app. Claude did most of the heavy lifting.**

<p align="center"><img width="40%" alt="SCR-20260803-guux" src="https://github.com/user-attachments/assets/60e0fb70-1a02-4088-b1f7-ad78b7dbfe46" /> &nbsp; <img width="40%" alt="SCR-20260803-gvct" src="https://github.com/user-attachments/assets/8f60837b-9136-4973-9b38-e97b8de00858" />
<img width="40%" alt="SCR-20260803-gvhk" src="https://github.com/user-attachments/assets/7bc56b36-a4b5-4371-8db2-f475b308a3b5" />&nbsp;<img width="40%" alt="SCR-20260803-gvnk" src="https://github.com/user-attachments/assets/c3d4c56b-138a-4a35-9673-c7857230e87b" />
<img width="40%" alt="SCR-20260803-gvwa" src="https://github.com/user-attachments/assets/6cd13000-affe-4126-9b92-8bce5781cff5" />&nbsp;<img width="40%" alt="image" src="https://github.com/user-attachments/assets/ca13d626-414b-4214-9b3f-555e16d82640" /></p>

<p align="center">
  <a href="https://www.buymeacoffee.com/jpmoo" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174">
</a>
</p>


---

## What you need

**A computer to run it on.** A spare Linux box, a Mac, or a Windows machine. It
can be the same computer you write on, or another one on your network that you
reach from a browser. It needn't be powerful — unless you want the AI features,
which want a decent graphics card.

**About twenty minutes**, most of it waiting for downloads.

**Enough comfort with a terminal** to open one, paste a command, and read what
comes back. You don't need to know what any of it means. The installers do the
work and tell you what they did.

---

## Installing

Pick your platform. Each installer does the same job: installs what Brigid
needs, sets up its database, builds the application, and arranges for it to
start automatically when the computer boots.

All three are safe to run twice. If one stops partway with an error, fix what it
complained about and run it again — it checks what is already done and skips it.

### Linux (Ubuntu or Debian)

```bash
git clone https://github.com/jpmoo/brigid.git
cd brigid
./install.sh
```

It will ask for your password once or twice. Installing software and setting up
a background service both need administrator rights.

### macOS

You need [Homebrew](https://brew.sh) first — that page has a one-line install if
you don't have it.

```bash
git clone https://github.com/jpmoo/brigid.git
cd brigid
./install-macos.sh
```

### Windows

Open PowerShell **as Administrator** (right-click it, choose "Run as
administrator"), then:

```powershell
git clone https://github.com/jpmoo/brigid.git
cd brigid
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-windows.ps1
```

It asks for the PostgreSQL password — the one set when PostgreSQL was installed.
If the script installs it for you, that's the password you were prompted for
during that step.

> The Windows installer is newer than the other two and has had less real-world
> use. If it goes wrong, the Linux and macOS paths are better trodden.

---

## First run

When the installer finishes it prints an address, something like:

```
http://192.168.1.40:8090
```

Open it in a browser. The first visit asks you to create an account — one
username and password, yours, stored on your own machine. Nothing to confirm by
email, nothing to verify.

Then make a manuscript and start writing.

**From another computer on your network**, use the address the installer printed
rather than `localhost`. If it doesn't load, see *When something's wrong*.

---

## Three ways of looking at it

The outline down the left is always the same manuscript. What changes is how the
middle shows it, and you switch with the three buttons above it.

**Book** sets your writing the way a novel is set: a comfortable measure,
generous leading, nothing on the page but the words. This is the one to write
in.

**Manuscript** sets it exactly as your submission templates specify — double
spaced, the right indents, the right font — so what you see is what will come
out of the compiler. Useful when you are close to sending it somewhere.

Clicking into a section in either one starts writing there. The style bar
carries bold, italic, and the rest; spelling is checked as you go, and the search
box walks every match in the whole manuscript rather than just the section you
are in. **Zen** (the expand button) drops the header and floats the outline, so
there is nothing left but the page.

### Canvas

**Canvas** shows the *shape* of the book rather than its text: every part,
chapter, and scene as a card on an endless surface, nested inside the thing that
contains it, with arrows for the order they are read in.

Anything with something inside it is drawn as a container rather than a card,
and its own writing — a chapter's opening, before its first scene — gets a card
of its own at the top of it. So a chapter is a rectangle holding its opening and
then its scenes, with the sequence running through all of them.

The arrows are worked out from the outline every time it is drawn, so reordering
a chapter redraws them immediately — there is no stored connection that could
quietly disagree with the book. Dragging never re-parents: a scene dropped
inside another chapter's rectangle has been moved on screen, not moved in the
book. Structure stays the outline's business, so an accidental drag can't
rewrite it.

- **Getting around.** Drag the background to pan, or scroll with two fingers.
  Pinch or Ctrl-scroll to zoom, or type a percentage. The dot grid can be turned
  off.
- **Arranging.** Drag a card to move it, drag a corner to resize it. Chapters
  grow and shrink around their scenes as you go. Everything is remembered, and
  **Reset** (hold to confirm) throws the arrangement away and lays it out fresh.
- **Notes.** Drag from a tab on any side of a card to hang a note off it, and
  drop it wherever you like — a dotted arrow keeps it pointed at the section it
  belongs to. Notes are bookmarks — the same list at the top of the outline — so
  one made here appears there, and one dropped on a line while writing appears
  here beside the section holding it.
- **Color.** Cards shade against their level's word goal, the same reading the
  outline gives — short of it, or past it. The goal belongs to the chapter, so
  it is the chapter that shades and not the card holding its opening.
- **Searching.** There is no reading order to scroll along, so search works
  differently here: every card holding the term lights up where it sits and the
  count is of sections rather than occurrences. Open one and you see all of its
  matches at once.
- **Writing.** Double-click a card to open that section in a room of its own —
  zen without the outline, the same editor with all the same features.

---

## Everyday use

Brigid runs in the background and starts itself when the computer does. You
shouldn't need to think about it. When you do:

|  | Linux | macOS | Windows |
|---|---|---|---|
| **Update** | `./restart.sh` | `./restart.sh` | see below |
| **Restart** | `sudo systemctl restart brigid` | `sudo launchctl kickstart -k system/com.brigid.app` | `Restart-ScheduledTask -TaskName Brigid` |
| **See logs** | `journalctl -u brigid -f` | `tail -f data/brigid.log` | Task Scheduler → Brigid |
| **Stop it** | `sudo systemctl stop brigid` | `sudo launchctl bootout system /Library/LaunchDaemons/com.brigid.app.plist` | `Stop-ScheduledTask -TaskName Brigid` |

Updating on Windows:

```powershell
git pull; pnpm install; pnpm build:web; pnpm db:migrate; Restart-ScheduledTask -TaskName Brigid
```

### Backups

Brigid backs itself up nightly — by default at 1am, keeping the last ten. You
can change that, take one immediately, or download one, under **Settings →
Backup**. Restoring can bring back a single manuscript or everything.

**Keep a copy somewhere else as well.** A backup living on the same disk as the
thing it is backing up is not really a backup. Downloading one now and then and
putting it wherever your other important files go is enough.

---

## The AI features

Optional, and off until you set them up. Brigid can read your manuscript and
tell you about its shape, its characters and the way you write. It talks to a
language model running on your own hardware, so the manuscript is never sent
anywhere.

### Setting it up

Brigid talks to a language model you run yourself. It does not care which
server you run it with — give it an address and it works out what is answering.

1. Install a model server on the machine with the best graphics card — the same
   one as Brigid, or another on your network. [Ollama](https://ollama.com) is
   the easiest starting point; [llama.cpp](https://github.com/ggml-org/llama.cpp),
   LM Studio and vLLM all work too, as does anything else serving the OpenAI
   shape.
2. Give it a model to serve. With Ollama that is `ollama pull qwen2.5:14b`, or
   any model you prefer; with the others it is usually an argument you start the
   server with.
3. In Brigid, open **Settings → AI Model**, enter the address, and press
   Connect.

What happens next depends on what answered. With Ollama you get a list of the
models you have installed and pick one, and Brigid reads how large a window
that model can hold and uses all of it — rather than the much smaller default
Ollama would otherwise serve, which truncates every chapter silently. With
anything else, whatever the server is already serving is what will answer,
because that was settled when you started it.

If your server wants an API key, there is a field for one. llama.cpp needs
none; vLLM started with `--api-key` does. It is stored in your own database in
the clear, next to the manuscript — which is fine for a box on your network and
is not a secret store.

Whatever address you give is where your manuscript goes when you use the AI
features. On a machine you run, it does not leave your network.

### What it does

Once connected, Brigid **reads the manuscript** in the background, section by
section. On a novel that takes roughly an hour. You can carry on writing while
it happens, and it keeps up with your edits by itself.

When it finishes, three tools appear under **Project Settings → AI**.

**Story shape** rates the manuscript against seven narrative frameworks —
Hero's Journey, Freytag's Pyramid, Three-Act, Save the Cat, the Story Circle,
Kishōtenketsu, and Seven-Point — judged on where your turns actually fall rather
than on whether they exist at all. A weak fit to all seven is a legitimate
finding, not a failure.

**Characters** profiles each character on ten role axes drawn from Vogler and
Propp — Hero, Mentor, Shadow, Trickster, Ally and so on — as a radar chart whose
*shape* describes their function in the story. Before anything is profiled you
review what the reading gathered: every recorded action can be moved to whoever
actually did it, reworded, or thrown out. Nothing is scored on a record you
haven't approved.

**Chat** discusses the manuscript with you, drawing on everything above plus the
actual passages your question bears on — so it can talk about your sentences as
well as your structure.

### Worth reading before you believe any of it

The model is a reader, not an authority. It will sometimes be confidently wrong
about your book, and it has no idea what you are trying to do.

Every score above the lowest is backed by the specific events it rested on, and
those are shown so you can check them. That is deliberate: a profile whose
evidence you cannot inspect is a profile you should not trust. When something
looks wrong, look at what it rested on — often the answer is that the reading
misattributed an action, which you can correct.

Treat all of it as one attentive reader's opinion, which is exactly the weight
it deserves.

---

## When something's wrong

**It doesn't load from another computer.** Brigid is probably running fine and
the machine's firewall is in the way. The Linux and Windows installers try to
open the port; macOS may prompt you to allow incoming connections the first
time, and you have to say yes.

**It worked yesterday and doesn't now.** Look at the logs — the table above says
how. The usual cause is PostgreSQL not having started; restarting the machine
generally sorts it, and Brigid waits for the database rather than giving up.

**The AI says the model timed out.** Usually the model is bigger than the
graphics card can comfortably hold, so it spills into ordinary memory and runs
many times slower. A smaller model is the fix.

**The reading is taking forever.** Roughly a minute a section, so a long novel is
an hour or more. You can stop it and pick it up later — **Characters → Stop
reading** — and nothing already read is lost.

**Anything else.** The logs almost always say. They are in plain English, and
the last twenty lines are usually enough.

---

## Where your writing lives

In PostgreSQL, on your own machine, in a database called `brigid`. The
application's settings live in `.env.local` and `data/brigid.config.json` inside
the folder you cloned.

Nothing is in the cloud, because there isn't one. That is the point of Brigid,
and it is also why the backups are your responsibility rather than someone
else's.

---

## For the technically inclined

To do it by hand, or to run Brigid behind a reverse proxy — including under a
subpath like `example.com/brigid` — see [docs/deploy.md](docs/deploy.md), with
the systemd unit in [deploy/brigid.service](deploy/brigid.service).

Brigid is a pnpm workspace: a Fastify server and a React client, TypeScript
throughout, PostgreSQL underneath with hand-written numbered migrations. The
design notes are in [docs/brigid-spec.md](docs/brigid-spec.md).

```bash
pnpm dev:server   # and, in another shell, pnpm dev:web
```

Vite proxies `/api` to port 8090, so the session cookie behaves exactly as it
does in production.

---

## License

MIT — see [LICENSE](LICENSE). Use it, change it, run it, share it. It comes with
no warranty, which for something holding a novel is worth reading as: keep your
own backups.

---

<p align="center">
  <a href="https://www.buymeacoffee.com/jpmoo" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="41" width="174"></a>
</p>
