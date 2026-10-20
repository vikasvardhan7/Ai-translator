# Putting the app online

This guide puts the app on a free Oracle Cloud server with a free web address from DuckDNS and free https. When it is done, anyone can open `https://<your name>.duckdns.org`, create an account and install the app on their phone or computer. It takes about an hour the first time.

What runs on the server:

- **app**: the backend and the built website in one container. Accounts, Gym Trainer data, meetings and API keys are kept in a Docker volume, so they survive restarts and updates.
- **web**: Caddy, which gets and renews the https certificate by itself and passes everything, live channels included, to the app.
- **duckdns**: checks every 5 minutes that the DuckDNS address still points to the server.

You need a card to sign up for Oracle Cloud. It is used only to check who you are; the Always Free server below is not charged. Oracle may hold and refund a small amount.

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
