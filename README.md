# ☁️🚀 Deploy Video-to-MP3 Converter to AWS with Pulumi 🎬🎵
This repository contains the Pulumi infrastructure code (IaC) written in TypeScript to deploy the [Node.js Video-to-MP3 Converter application](https://github.com/sojinsamuel/video-to-mp3-app-example) to AWS.

**The Goal:** To automate the provisioning of AWS resources (EC2, Application Load Balancer, Security Groups, VPC configuration) required to host and run the web application, making deployment repeatable and manageable.

**📖 Companion Tutorial:** This repository is best understood alongside the detailed tutorial available on dev.to:
**[https://dev.to/sojinsamuel/pulumi-v2-4fai]**

---

## 🏗️ Architecture Overview

This Pulumi program deploys the following AWS resources:

1.  **Networking:** Uses your AWS account's **Default VPC** and associated **Subnets**.
2.  **Security Groups:**
    *   `alb-sg`: Allows public HTTP traffic (port 80) to the Load Balancer.
    *   `instance-sg`: Allows traffic from the ALB to the EC2 instance on the application port (3001) and allows SSH access (port 22) for management (**Important:** Restrict SSH source IP!). Allows all outbound traffic.
3.  **Compute:** An **EC2 Instance** (defaulting to `t2.micro`, free tier eligible) running Ubuntu 22.04 LTS. A `userData` script handles bootstrapping:
    *   Installs `git`, `curl`.
    *   Installs `nvm` (Node Version Manager).
    *   Uses `nvm` to install and use Node.js v20.x.
    *   Clones the application code from *this* repository.
    *   Runs `npm install` for application dependencies.
    *   Installs `pm2` globally.
    *   Starts the Node.js application (`server.js`) using `pm2`.
4.  **Load Balancer:** An **Application Load Balancer (ALB)** (`webapp-lb`) to distribute incoming HTTP traffic.
5.  **Target Group:** An ALB **Target Group** (`webapp-tg`) pointing to the EC2 instance on port 3001, with health checks configured.
6.  **Listener:** An ALB **Listener** (`webapp-listener`) on port 80 forwarding traffic to the target group.

---

## 📂 Project Structure

This repository contains two main directories:

```
pulumi-video-converter-deploy/  (Git repository root)
├── .git/
├── .gitignore
├── video-to-mp3-app/    # <-- Contains the actual Node.js application code
│   ├── public/
│   ├── server.js
│   ├── package.json
│   └── ...
└── pulumi-infra/       # <-- Contains the Pulumi Infrastructure as Code
    ├── node_modules/    # (Ignored by Git)
    ├── .pulumi/         # (Pulumi state info - Ignored by Git)
    ├── index.ts         # Pulumi program defining AWS resources
    ├── package.json     # Pulumi project dependencies
    ├── Pulumi.yaml      # Pulumi project definition
    ├── Pulumi.dev.yaml  # Pulumi stack configuration (region, repo url, key name)
    └── tsconfig.json    # TypeScript config for Pulumi
```

---

## ✅ Prerequisites

Before you begin, ensure you have the following installed and configured:

*   [An AWS account](https://signin.aws.amazon.com/signup?request_type=register) with billing enabled.
*   [AWS CLI installed](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) and [configured](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-quickstart.html) with credentials for your target AWS account and region. Run `aws configure`.
*   [Pulumi CLI installed](https://www.pulumi.com/docs/iac/download-install/).
*   [Node.js](https://nodejs.org/en/download) and npm (v18+ recommended for running Pulumi TypeScript).
*   [Git installed](https://git-scm.com/downloads).
*   A [GitHub account](https://github.com/).

---

## 🚀 Deployment Steps

1.  **Clone This Repository:**
    ```bash
    git clone https://github.com/sojin-samuel/pulumi-video-converter-deploy.git
    cd pulumi-video-converter-deploy
    ```

2.  **Navigate to Infrastructure Code:**
    ```bash
    cd pulumi-infra
    ```
    *(Pulumi commands must be run from within the Pulumi project directory)*

3.  **Install Pulumi Dependencies (if needed):**
    The `pulumi new` command usually runs this, but if you encounter issues:
    ```bash
    npm install
    ```

4.  **Verify AWS CLI Configuration:** Ensure your AWS CLI is configured for the correct account and target deployment region.
    ```bash
    aws configure list
    aws sts get-caller-identity # Verify account ID
    ```

5.  **Create EC2 Key Pair:**
    *   Go to the [AWS EC2 Console](https://console.aws.amazon.com/ec2/home) -> Key Pairs.
    *   Click "Create key pair".
    *   Enter a **Name** (e.g., `my-app-key`).
    *   Select **RSA** and **.pem** format.
    *   Click "Create key pair". **Save the downloaded `.pem` file securely** (e.g., `~/.ssh/my-app-key.pem`).
    *   **Set permissions:** `chmod 400 ~/.ssh/my-app-key.pem` (or the path where you saved it).
    <!-- GIF: Showing Key Pair creation -->

6.  **Configure Pulumi Stack:** Set the required configuration values for the `dev` stack.
    *   **Set Application Repo URL:** Use the HTTPS URL of **this** repository (`pulumi-video-converter-deploy`). The `userData` script needs this to clone the `video-to-mp3-app` subdirectory.
        ```bash
        pulumi config set appRepoUrl https://github.com/sojinsamuel/pulumi-video-converter-deploy.git
        ```
        <!-- GIF: Running pulumi config set appRepoUrl -->
    *   **Set EC2 Key Pair Name:** Use the *exact name* you created in the AWS console (without `.pem`).
        ```bash
        # Replace 'my-app-key' with the name you created
        pulumi config set keyPairName my-app-key
        ```
        <!-- GIF: Running pulumi config set keyPairName -->
    *   **(Optional) Check Config:** Verify values in `Pulumi.dev.yaml` or run `pulumi config`.

7.  **Deploy the Infrastructure:**
    ```bash
    pulumi up
    ```
    *   Pulumi calculates the required changes and shows a preview.
    *   Review the plan (it should show 8 resources to create initially).
    *   Type `yes` and press Enter to confirm.
    *   Wait for the deployment to complete (5-10 minutes). Note the output values.
    <!-- GIF: Running pulumi up and showing successful output -->

8.  **Verify Deployment:**
    *   **Wait:** Allow ~5 minutes *after* `pulumi up` finishes for the EC2 instance `userData` script to fully execute.
    *   **Check Target Health:** Go to AWS Console -> EC2 -> Target Groups -> Select `webapp-tg` -> Targets tab. Wait for the instance status to become `healthy`.
    *   **Access Application:** Open the `albUrl` from the Pulumi output in your browser. You should see the Video Converter application!

---

## 🔒 Security Note: SSH Access

The default EC2 security group (`instance-sg`) created by this code allows SSH access (port 22) from *anywhere* (`0.0.0.0/0`). **This is insecure for production.**

**ACTION REQUIRED:** Edit `pulumi-infra/index.ts`, find the SSH ingress rule within `instanceSg`, change `cidrBlocks: ["0.0.0.0/0"]` to `cidrBlocks: ["YOUR_PUBLIC_IP/32"]` (find your IP by searching "what is my IP"), save the file, and run `pulumi up` again to apply the change.

<!-- GIF: Showing how to find IP and edit the SG rule -->

---

## 💸 Cost Considerations

Running these resources on AWS incurs costs (EC2 instance, ALB, data transfer). The `t2.micro` instance type is typically Free Tier eligible, but the ALB is not.

**Remember to destroy the resources when you are finished** to avoid ongoing charges:

```bash
# Run from the pulumi-infra directory
pulumi destroy
```
Confirm with `yes`.

---

## 🩺 Troubleshooting

*   **502 Bad Gateway:** Usually means the app failed to start on EC2. Check Target Group health. SSH into the instance (using `instancePublicIp` and your key pair) and examine:
    *   `sudo cat /var/log/cloud-init.log | grep -i 'error\|fail\|warn'` (Detailed boot logs)
    *   `pm2 list` (Check if `video-converter` is `online`)
    *   `pm2 logs video-converter` (Check for application errors)
    *   `node -v` and `npm -v` (Verify correct versions installed by nvm)
    *   `ls -la /home/ubuntu/app/video-to-mp3-app` (Verify code and `node_modules` exist)
    *   `sudo ss -tulpn | grep 3001` (Check if Node is listening)
*   **`pulumi up` fails (Key Pair error):** Ensure the `keyPairName` in `Pulumi.dev.yaml` exactly matches the name in AWS EC2 Key Pairs for your selected region.
*   **`pulumi up/destroy` fails (ARN errors):** This can happen after credential changes or failed updates.
---

## 🤝 Contributing

Contributions are welcome! Please refer to the main application repository ([`video-to-mp3-app-example`](https://github.com/sojinsamuel/video-to-mp3-app-example)) for application-specific contributions. For infrastructure improvements, feel free to open an issue or PR here.
