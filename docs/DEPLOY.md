# Putting the app online

There are two free ways. Both give a fixed https address that anyone can open, create an account on and install as an app.

- **Way 1, no card needed: your laptop.** The laptop runs the app, a free domain from DigitalPlat gives it a fixed name, and Cloudflare carries visitors to it. It works whenever the laptop is on, awake and online.
- **Way 2, needs a card: a free Oracle Cloud server.** Always on, even when the laptop is off. Oracle checks a Visa or Mastercard card with a small refunded hold; RuPay, prepaid and virtual cards are refused.

# Way 1: your laptop, a free domain and Cloudflare (no card)

It takes about 30 minutes, plus up to a day for the domain to become active.

## 1. Make a free Cloudflare account

Go to https://dash.cloudflare.com/sign-up and sign up with your email. No card is needed.

## 2. Get a free domain and give it to Cloudflare

1. In Cloudflare, choose **Add a domain** (or **Add a site**), type the name you want, such as `vikas-translator.dpdns.org`, and choose the **Free** plan. Cloudflare shows two nameservers, such as `anna.ns.cloudflare.com` and `bob.ns.cloudflare.com`. Keep that page open.
2. Go to https://dash.domain.digitalplat.org, make an account and sign in.
3. Register the same name under **.dpdns.org**. Where it asks for nameservers, choose external nameservers only and paste Cloudflare's two into NS1 and NS2.
4. Back in Cloudflare, press **Check nameservers now**. The domain shows **Active** after a few minutes, at most a day.

DigitalPlat domains are free for a year at a time: renew yours in its dashboard when it asks, or it is released.

## 3. Connect the domain to your laptop

1. In Cloudflare, open **Networking**, then **Tunnels** (on older dashboards **Zero Trust**, then **Networks**, then **Tunnels**), and press **Create a tunnel**. Choose **Cloudflared**, name it `voice-translator`, and choose **Windows**.
2. Copy the command it shows; it starts with `cloudflared.exe service install` followed by a long token. Open PowerShell **as administrator** (right-click PowerShell, **Run as administrator**) and paste it. This makes Cloudflare's connector a Windows service that starts with the laptop. The tunnel turns **Healthy**.
3. Press **Next** (or **Add route**, then **Published application**): leave **Subdomain** empty, pick your domain, set **Type** to **HTTP** and **URL** to `localhost:8000`, and save.

If Cloudflare asks for a card at any step, stop there: the domain and the tunnel are free, and there is a way to do the same with commands only.

## 4. Point the app at its address

Open `C:\dev\Ai-translator\backend\.env` in Notepad and set these lines with your domain, keeping each name only once:

```
PUBLIC_URL=https://vikas-translator.dpdns.org
FRONTEND_ORIGIN=http://localhost:5173
HOST_KEY_EVERYWHERE=true
```

`SMTP_USERNAME`, `SMTP_PASSWORD`, `GEMINI_API_KEY` and `GEMINI_MODEL` must be filled in too (see the README). Close any quick tunnel window (`cloudflared tunnel --url ...`); it is not needed any more.

## 5. Start the app, and start it by itself from now on

Build the website once, and again after every update:

```
cd C:\dev\Ai-translator\frontend
npm run build
```

Double-click `start-server.cmd` in `C:\dev\Ai-translator` to try it. It first stops any backend that is still running (no more port 8000 errors), then starts it; closing that window stops the website. Open your domain on your phone, using mobile data, and sign in.

When it works, close that window and make the backend start by itself whenever you sign in to Windows (PowerShell):

```
cd C:\dev\Ai-translator
powershell -ExecutionPolicy Bypass -File .\start-server.ps1 -AtSignIn
```

It runs in the background from then on. Its messages, the host key included, go to `backend\data\server.log`. Double-clicking `start-server.cmd` later stops the background copy and runs the backend in that window instead; run the line above again to go back to the background. To stop it starting by itself: `Unregister-ScheduledTask -TaskName 'Voice Translator' -Confirm:$false`.

## 6. Keep the laptop available

```
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Also set **Control Panel**, **Power Options**, **Choose what closing the lid does** to **Do nothing** when plugged in, and keep the laptop plugged in and online. After a restart, sign in to Windows once: the tunnel is already running, and the backend starts at sign-in.

## Updating

After a pull request is merged:

```
cd C:\dev\Ai-translator
git switch main
git pull
cd frontend
npm run build
cd ..
powershell -ExecutionPolicy Bypass -File .\start-server.ps1 -AtSignIn
```

The last line restarts the background backend with the new version. Everyone keeps their account and data, which stay in `backend\data`.

# Way 2: a free Oracle Cloud server (needs a card)

This puts the app on a free Oracle Cloud server with a free web address from DuckDNS and free https. When it is done, anyone can open `https://<your name>.duckdns.org`, even when your laptop is off. It takes about an hour the first time.

What runs on the server:

- **app**: the backend and the built website in one container. Accounts, Gym Trainer data, meetings and API keys are kept in a Docker volume, so they survive restarts and updates.
- **web**: Caddy, which gets and renews the https certificate by itself and passes everything, live channels included, to the app.
- **duckdns**: checks every 5 minutes that the DuckDNS address still points to the server.

You need a Visa or Mastercard card to sign up for Oracle Cloud; a family member's works too. It is used only to check who you are; the Always Free server below is not charged. Oracle holds and refunds a small amount.

## 1. Create the Oracle Cloud account

1. Go to https://signup.cloud.oracle.com and sign up for the free tier.
2. For **Home region** pick one near your users, such as **India West (Mumbai)** or **India South (Hyderabad)**. It cannot be changed later.
3. Wait for the email saying the account is ready, then sign in at https://cloud.oracle.com.

## 2. Create the server

1. Open the menu, then **Compute**, then **Instances**, and press **Create instance**.
2. Name it `voice-translator`.
3. **Image and shape**: press **Edit**.
   - **Change image**: choose **Canonical Ubuntu**, version **24.04**.
   - **Change shape**: choose **Ampere**, then **VM.Standard.A1.Flex**, with **1 OCPU** and **6 GB** memory. Both are inside the Always Free allowance.
   - If Oracle says it is out of capacity, try another **Availability domain**, try again later, or choose **Specialty and previous generation**, then **VM.Standard.E2.1.Micro** (also Always Free; slower, and setup adds swap so it can build).
4. **Networking**: keep **Create new virtual cloud network** and **Create new public subnet**, and make sure **Assign a public IPv4 address** is on.
5. **Add SSH keys**: choose **Generate a key pair for me** and press **Save private key**. Keep that file; it is the only way into the server.
6. Press **Create**. When the instance shows **Running**, copy its **Public IP address**.

## 3. Open the web ports

1. On the instance page, under **Primary VNIC**, open the **Subnet**, then its **Default Security List**.
2. Press **Add Ingress Rules** and add two rules, both with **Source CIDR** `0.0.0.0/0` and **IP Protocol** **TCP**:
   - **Destination Port Range** `80`
   - **Destination Port Range** `443`

The setup script opens the same two ports in the server's own firewall.

## 4. Get the free address

1. Go to https://www.duckdns.org and sign in (with Google or GitHub, for example).
2. Type a subdomain, such as `vikas-translator`, and press **add domain**.
3. In **current ip**, paste the server's public IP and press **update ip**.
4. Keep the page open: you need the subdomain and the **token** shown at the top.

## 5. Connect to the server

On your laptop, in PowerShell, one command per line. Replace the file name with the private key you saved and `<public IP>` with the server's address:

```
mkdir $HOME\.ssh -Force
Move-Item $HOME\Downloads\ssh-key-*.key $HOME\.ssh\oracle.key
icacls $HOME\.ssh\oracle.key /inheritance:r
icacls $HOME\.ssh\oracle.key /grant:r "$($env:USERNAME):(R)"
ssh -i $HOME\.ssh\oracle.key ubuntu@<public IP>
```

Answer `yes` the first time. The prompt changes to `ubuntu@voice-translator`.

## 6. Install and start the app

On the server, one command per line:

```
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/vikasvardhan7/Ai-translator.git
cd Ai-translator/deploy
bash setup.sh
```

If the repository is private, Git asks for a user name and password: type your GitHub user name, and as the password paste a token from https://github.com/settings/personal-access-tokens with read-only **Contents** access to this repository.

The first run opens the firewall, installs Docker and creates the settings file `deploy/.env`. Fill it in:

```
nano .env
```

- `DOMAIN`: your full address, such as `vikas-translator.duckdns.org`
- `DUCKDNS_SUBDOMAIN` and `DUCKDNS_TOKEN`: from the DuckDNS page
- `GEMINI_API_KEY`, `GEMINI_MODEL` and the other Gemini lines: the same values as in `backend\.env` on your laptop
- `SMTP_USERNAME` and `SMTP_PASSWORD`: the same Gmail address and app password as on your laptop

Save with Ctrl+O, Enter, then Ctrl+X, and start it:

```
bash setup.sh
```

The first build takes 5 to 10 minutes. Then open `https://<your DOMAIN>`. The certificate is fetched on the first visit, which can take a minute.

## 7. Check it

```
sudo docker compose ps
sudo docker compose logs --tail 50 app
sudo docker compose logs --tail 20 web
sudo docker compose logs duckdns
```

All three services should say `running` (the app also `healthy`). The app log shows the host key on its line starting `Host key:`; the Developers app asks for it when you manage API keys from the public address. It changes every time the app restarts.

## Updating to a new version

After a pull request is merged into `main`, on the server:

```
cd ~/Ai-translator/deploy
bash update.sh
```

It downloads the new code, rebuilds and restarts. Everyone stays signed in and keeps their data; open pages reload into the new version the next time they are opened.

## Backups

```
cd ~/Ai-translator/deploy
bash backup.sh
```

This saves a consistent copy of every database in `deploy/backups/<date>`. To keep one on your laptop, in PowerShell:

```
scp -i $HOME\.ssh\oracle.key -r ubuntu@<public IP>:Ai-translator/deploy/backups C:\dev\server-backups
```

To make a backup every night at 03:30, run `crontab -e` on the server and add this line:

```
30 3 * * * cd /home/ubuntu/Ai-translator/deploy && bash backup.sh >/dev/null 2>&1
```

## Installing the app

The website is also an installable app; there is nothing to publish to a store.

- **Android (Chrome)**: open the address, then **Install app** on the desktop, or the browser menu, then **Install app**.
- **iPhone and iPad (Safari)**: open the address, tap **Share**, then **Add to Home Screen**.
- **Windows and Mac (Chrome or Edge)**: open the address and press the install icon at the right of the address bar, or **Install app** on the desktop.

The installed app opens in its own window with its own icon, always runs the version on the server, and shows a short "You are offline" page instead of an error when there is no internet.

## Good to know

- **Idle servers**: Oracle may reclaim an Always Free server that stays idle for 7 days (under 20% processor, network and, on Ampere, memory use). A small app with few visitors can look idle. Upgrading the account to **Pay As You Go** is reported to stop this while Always Free resources stay free, but it allows charges for anything beyond them, so set a budget alert if you do. If the server is stopped, start it again from the instance page; the data is kept.
- **Gemini limits**: every visitor shares your Gemini free-tier quota. Each account is limited to 30 AI requests a minute and 300 a day (`USER_REQUESTS_PER_MINUTE`, `USER_REQUESTS_PER_DAY` in `deploy/.env`); when the free quota for the day is used up, translation and the AI features stop until it resets.
- **Privacy**: on Google's free tier, what is sent to Gemini may be used to improve Google's products. The privacy page already says so.
- **Your laptop** is no longer needed for the public version. Running the backend on the laptop still works for testing.
- **Your own domain** later: point it to the server's IP at your domain seller, put it in `DOMAIN`, empty the two DuckDNS lines, and run `bash setup.sh` again.
