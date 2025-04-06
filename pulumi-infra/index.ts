import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
// Instance type for EC2, defaulting to t2.micro (free tier eligible)
const instanceType = config.get("instanceType") || "t2.micro";
// **Placeholder for Our app's GitHub repo URL - we'll set this later!**
const appRepoUrl = config.require("appRepoUrl");

// --- Networking (Using Default VPC) ---
const vpc = aws.ec2.getVpc({ default: true });
const vpcId = vpc.then(v => v.id);

const subnetIds = vpc.then(v => aws.ec2.getSubnets({
    filters: [{ name: "vpc-id", values: [v.id] }]
})).then(s => s.ids);

// --- Security Groups ---

// ___Security Group for the Application Load Balancer (ALB)___
// Allows public HTTP traffic on port 80
const albSg = new aws.ec2.SecurityGroup("alb-sg", {
    vpcId: vpcId,
    description: "Allow HTTP inbound traffic for ALB",
    ingress: [{ // Allow HTTP from anywhere
        protocol: "tcp", fromPort: 80, toPort: 80, cidrBlocks: ["0.0.0.0/0"],
    }],
    egress: [{ // Allow all outbound traffic
        protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: { Name: "video-to-audio-converter-alb-sg" },
});

// ___Security Group for the EC2 Instance___
// Allows traffic from ALB on port 3001 and SSH 
const instanceSg = new aws.ec2.SecurityGroup("webapp-instance-sg", {
    vpcId: vpcId,
    description: "Allow HTTP from ALB and SSH",
    ingress: [
        { // Allow HTTP traffic on port 3001 ONLY from the ALB
            protocol: "tcp", fromPort: 3001, toPort: 3001, securityGroups: [albSg.id],
        },
        { // Allow SSH traffic on port 22 - **IMPORTANT: Restrict this CIDR block!**
            protocol: "tcp", fromPort: 22, toPort: 22, cidrBlocks: ["0.0.0.0/0"], // <-- Change to your IP/32
        },
    ],
    egress: [{ // Allow all outbound traffic (for apt-get, git clone, npm, External APIs)
        // This is a broad rule, consider restricting it further based on your needs
        protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"],
    }],
    tags: { Name: "video-converter-instance-sg" },
});

// --- EC2 Instance ---

// Find the latest Ubuntu 22.04 LTS AMI (Jammy) for amd64
const ami = aws.ec2.getAmi({
    filters: [
        { name: "name", values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"] },
        { name: "virtualization-type", values: ["hvm"] },
    ],
    mostRecent: true,
    owners: ["099720109477"], // Canonical's AWS account ID
});

// **IMPORTANT**: (Assumes you have an existing key pair created in AWS)
const keyPairName = config.require("keyPairName");

console.log(`---> DEBUG: Pulumi resolved keyPairName as: '${keyPairName}'`);

const userData = pulumi.interpolate`#!/bin/bash
# Exit on first error
set -e
echo ">>>> Starting UserData script..."

# --- Install git ---
echo ">>>> Installing git..."
sudo apt-get update -y && sudo apt-get install -y git
echo ">>>> Git installed."

# --- Clone the repo into /home/ubuntu/app ---
echo ">>>> Cloning repository ${appRepoUrl} into /home/ubuntu/app..."
sudo -u ubuntu git clone ${appRepoUrl} /home/ubuntu/app
echo ">>>> Clone finished."

# --- Install NVM and Node.js as ubuntu user ---
echo ">>>> Installing NVM and Node.js 22 for user ubuntu..."
sudo -i -u ubuntu bash << EOF
echo ">>>> Running as ubuntu user for NVM install..."
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash
\\. "\\$HOME/.nvm/nvm.sh"
nvm install 22
nvm use 22
nvm alias default 22
echo ">>>> Node.js installed. Verifying versions..."
node -v
nvm current
npm -v
EOF
echo ">>>> Finished NVM and Node.js installation."

# --- Install dependencies and setup PM2 in video-to-mp3-app ---
echo ">>>> Setting up application in /home/ubuntu/app/video-to-mp3-app..."
sudo -i -u ubuntu bash << EOF
\\. "\\$HOME/.nvm/nvm.sh"
cd /home/ubuntu/app/video-to-mp3-app
echo ">>>> Running npm install..."
npm install
echo ">>>> npm install finished."
echo ">>>> Installing PM2 globally..."
npm install pm2 -g
echo ">>>> Starting server.js with PM2..."
pm2 start server.js --name video-converter
echo ">>>> PM2 process started."
EOF
echo ">>>> Application setup finished."

echo ">>>> UserData script finished successfully."
`;

// Create the EC2 instance
const instance = new aws.ec2.Instance("webapp-instance", {
    instanceType: instanceType,
    ami: ami.then(a => a.id),
    vpcSecurityGroupIds: [instanceSg.id],
    subnetId: subnetIds.then(ids => ids[0]), // Use the first default subnet
    keyName: keyPairName, // Assign your key pair for SSH access
    userData: userData, // Run the setup script on launch
    tags: { Name: "video-to-audio-converter" },
});

// --- Application Load Balancer (ALB) ---

// Create the ALB, Target Group, and Listener
const alb = new aws.lb.LoadBalancer("webapp-lb", {
    internal: false,
    loadBalancerType: "application",
    securityGroups: [albSg.id],
    subnets: subnetIds, // Assign the ALB to the default subnets
    tags: { Name: "video-to-audio-converter-alb" },
});

const targetGroup = new aws.lb.TargetGroup("webapp-tg", {
    port: 3001, protocol: "HTTP", targetType: "instance", vpcId: vpcId,
    healthCheck: { // Basic health check for the root path
        path: "/", protocol: "HTTP", matcher: "200-399", interval: 30, timeout: 5,
        healthyThreshold: 2, unhealthyThreshold: 2,
    },
    tags: { Name: "video--audio-converter-tg" },
});

const targetGroupAttachment = new aws.lb.TargetGroupAttachment("webapp-tg-attachment", {
    targetGroupArn: targetGroup.arn,
    targetId: instance.id,
    port: 3001,
});

const listener = new aws.lb.Listener("webapp-listener", {
    loadBalancerArn: alb.arn,
    port: 80, protocol: "HTTP",
    defaultActions: [{ type: "forward", targetGroupArn: targetGroup.arn }],
});

// --- Outputs ---
// Public DNS name of the ALB so we can access the app
export const albUrl = alb.dnsName;
// Instance ID for reference
export const instanceId = instance.id;
// Public IP of the instance for SSH access
export const instancePublicIp = instance.publicIp;
