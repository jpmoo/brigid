<p align="center"><img width="50%" alt="image" src="https://github.com/user-attachments/assets/b5bf6302-4e80-4b36-be29-2297628c8569" /></p>


A web application for writing novels and short stories that you run on your own hardware or network. Named after the Celtic
goddess of poetry.

Brigid keeps your manuscript as a structured outline rather than one long file, so
you can move a chapter without cutting and pasting twenty pages. It handles the
things a novel needs and a word processor doesn't: parts and chapters and scenes
that know what they are, formatting decided once and applied everywhere,
compiling to a submission manuscript, and — if you want it — a local AI that
reads the book and tells you what shape it has, maps your characters to archetypes, and lets you chat about your work.

Nothing leaves your machine or server until you're ready to compile into a Word document or a PDF. There is no account with anyone, no subscription,
and no company that can change the terms later. If you use the AI features, the
model runs on hardware you control too.

**This is a vibe-coded app. Claude did most of the heavy lifting.**

<p align="center"><img width="40%" alt="SCR-20260803-guux" src="https://github.com/user-attachments/assets/60e0fb70-1a02-4088-b1f7-ad78b7dbfe46" /> &nbsp; <img width="40%" alt="SCR-20260803-gvct" src="https://github.com/user-attachments/assets/8f60837b-9136-4973-9b38-e97b8de00858" />
<img width="40%" alt="SCR-20260803-gvhk" src="https://github.com/user-attachments/assets/7bc56b36-a4b5-4371-8db2-f475b308a3b5" />&nbsp;<img width="40%" alt="SCR-20260803-gvnk" src="https://github.com/user-attachments/assets/c3d4c56b-138a-4a35-9673-c7857230e87b" />
<img width="40%" alt="SCR-20260803-gvwa" src="https://github.com/user-attachments/assets/6cd13000-affe-4126-9b92-8bce5781cff5" /></p>

<p align="center"><a href="https://www.buymeacoffee.com/jpmoo" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="45" /></a></p>


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
tell you about its shape and its characters. It uses
[Ollama](https://ollama.com), which runs a language model on your own hardware,
so the manuscript is never sent anywhere.

### Setting it up

1. Install Ollama on the machine with the best graphics card — the same one as
   Brigid, or another on your network.
2. Download a model: `ollama pull qwen2.5:14b`, or any model you prefer.
3. In Brigid, open **Settings → Ollama**, enter the address (usually
   `http://localhost:11434`), press Connect, and choose the model.

Brigid works out how much that model can hold and uses all of it, rather than
the much smaller default Ollama would otherwise serve.

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

## Licence

MIT — see [LICENSE](LICENSE). Use it, change it, run it, share it. It comes with
no warranty, which for something holding a novel is worth reading as: keep your
own backups.

---

<p align="center"><a href="https://www.buymeacoffee.com/jpmoo" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="45" /></a></p>
