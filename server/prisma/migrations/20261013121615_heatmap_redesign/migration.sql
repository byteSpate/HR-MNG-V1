-- Heatmap redesign (owner, 2026-10-13). New tables first, then the
-- starting list and the old Need answers copied across, then the old tables
-- dropped. Order matters: the copy reads SalesAccountHeatmapNeed.

-- CreateEnum
CREATE TYPE "HeatmapPickColour" AS ENUM ('GREEN', 'RED');

-- CreateTable
CREATE TABLE "HeatmapGroup" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatmapGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatmapProduct" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatmapProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeatmapPart" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "position" INTEGER NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeatmapPart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAccountHeatmapPick" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "colour" "HeatmapPickColour" NOT NULL,
    "reason" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAccountHeatmapPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAccountHeatmapScope" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAccountHeatmapScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeatmapProduct_groupId_idx" ON "HeatmapProduct"("groupId");

-- CreateIndex
CREATE INDEX "HeatmapPart_productId_idx" ON "HeatmapPart"("productId");

-- CreateIndex
CREATE INDEX "SalesAccountHeatmapPick_productId_idx" ON "SalesAccountHeatmapPick"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountHeatmapPick_salesAccountId_productId_key" ON "SalesAccountHeatmapPick"("salesAccountId", "productId");

-- CreateIndex
CREATE INDEX "SalesAccountHeatmapScope_partId_idx" ON "SalesAccountHeatmapScope"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountHeatmapScope_salesAccountId_partId_key" ON "SalesAccountHeatmapScope"("salesAccountId", "partId");

-- AddForeignKey
ALTER TABLE "HeatmapProduct" ADD CONSTRAINT "HeatmapProduct_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "HeatmapGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeatmapPart" ADD CONSTRAINT "HeatmapPart_productId_fkey" FOREIGN KEY ("productId") REFERENCES "HeatmapProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapPick" ADD CONSTRAINT "SalesAccountHeatmapPick_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapPick" ADD CONSTRAINT "SalesAccountHeatmapPick_productId_fkey" FOREIGN KEY ("productId") REFERENCES "HeatmapProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapScope" ADD CONSTRAINT "SalesAccountHeatmapScope_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapScope" ADD CONSTRAINT "SalesAccountHeatmapScope_partId_fkey" FOREIGN KEY ("partId") REFERENCES "HeatmapPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The starting list (owner, 2026-10-13) ─────────────────────────────────
-- `legacy_key` exists only inside this migration, to carry old answers over.
CREATE TEMP TABLE heatmap_seed_product (group_title TEXT, title TEXT, position INT, legacy_key TEXT);
CREATE TEMP TABLE heatmap_seed_part (product_title TEXT, title TEXT, note TEXT, position INT);

INSERT INTO "HeatmapGroup" ("id", "title", "position", "updatedAt") VALUES
  (gen_random_uuid(), 'Network', 1, now()),
  (gen_random_uuid(), 'Servers and data', 2, now()),
  (gen_random_uuid(), 'Phones and building security', 3, now()),
  (gen_random_uuid(), 'Cybersecurity', 4, now()),
  (gen_random_uuid(), 'Software and services', 5, now());

INSERT INTO heatmap_seed_product VALUES
  ('Network', 'Router', 1, 'router'),
  ('Network', 'Switch', 2, 'switch'),
  ('Network', 'Wi-Fi', 3, 'wireless'),
  ('Network', 'Network monitoring (NMS)', 4, NULL),
  ('Servers and data', 'Server', 1, 'server'),
  ('Servers and data', 'Virtualization and private cloud', 2, NULL),
  ('Servers and data', 'Storage and backup', 3, 'storage'),
  ('Servers and data', 'Data centre or server room', 4, 'dataCentre'),
  ('Phones and building security', 'IP phone and PBX', 1, 'ipPhone'),
  ('Phones and building security', 'Video conferencing', 2, 'videoConferencing'),
  ('Phones and building security', 'CCTV', 3, 'cctv'),
  ('Phones and building security', 'Access control and attendance', 4, 'accessControl'),
  ('Cybersecurity', 'Network security', 1, 'firewall'),
  ('Cybersecurity', 'User and endpoint security', 2, 'antivirus'),
  ('Cybersecurity', 'App and API security', 3, NULL),
  ('Cybersecurity', 'AI and SOC', 4, NULL),
  ('Software and services', 'Business software', 1, 'software'),
  ('Software and services', 'App care', 2, NULL),
  ('Software and services', 'SSL certificate', 3, 'ssl'),
  ('Software and services', 'Managed services', 4, NULL);

INSERT INTO heatmap_seed_part VALUES
  ('Router', 'Small range router', 'Up to 1 Gbps. Small office and branch office.', 1),
  ('Router', 'Mid range router', 'Up to 3 Gbps. Campus core, medium company.', 2),
  ('Router', 'High end router', 'Above 3 Gbps. Data centre core, large company.', 3),
  ('Router', 'SD-WAN', 'Joins many offices over the internet.', 4),
  ('Switch', 'Access switch', 'PoE and non-PoE. 8, 16, 24 or 48 ports. For PCs, Wi-Fi, IP phones and CCTV.', 1),
  ('Switch', 'Distribution switch', 'Copper and fibre. 12 to 48 ports. 1G, 10G or 25G.', 2),
  ('Switch', 'Core switch', 'Network backbone. Fixed or chassis. 10G or 25G.', 3),
  ('Switch', 'Server farm and DC switch', 'Data centre switch. 1G up to 400G.', 4),
  ('Wi-Fi', 'Small density AP', '10 to 25 users on each AP. Small office, shop, small rooms.', 1),
  ('Wi-Fi', 'Mid density AP', '40 to 60 users on each AP. Classroom, office.', 2),
  ('Wi-Fi', 'High density AP', '60 or more users on each AP. Hall, auditorium, outdoor.', 3),
  ('Wi-Fi', 'Wi-Fi controller', 'Manages all access points in one place.', 4),
  ('Network monitoring (NMS)', 'Monitoring software', 'Watches network devices and warns about problems.', 1),
  ('Network monitoring (NMS)', '24/7 monitoring service', 'Our team watches the network day and night.', 2),
  ('Server', 'Rack server', 'For apps and databases.', 1),
  ('Server', 'GPU server', 'For AI training, video work and VDI.', 2),
  ('Server', 'Tower server', 'A small server for a small office.', 3),
  ('Server', 'Blade server', 'Many servers in one box. Saves space.', 4),
  ('Virtualization and private cloud', 'Server virtualization', 'Many virtual servers on one machine. Licensed for each server.', 1),
  ('Virtualization and private cloud', 'Private cloud infra', 'Open-source cloud in their own building.', 2),
  ('Virtualization and private cloud', 'Kubernetes and containers', 'Runs modern apps in containers.', 3),
  ('Storage and backup', 'NAS', 'Shared file storage on the network.', 1),
  ('Storage and backup', 'SAN', 'Fast storage for servers.', 2),
  ('Storage and backup', 'Backup software', 'Copies data so it can be brought back.', 3),
  ('Storage and backup', 'Tape or offsite copy', 'A copy of the data kept in another place.', 4),
  ('Storage and backup', 'Disaster recovery (DR)', 'A second site, so work goes on after a disaster.', 5),
  ('Data centre or server room', 'Racks', 'Cabinets that hold servers and network devices.', 1),
  ('Data centre or server room', 'Cooling', 'Air conditioning for the server room.', 2),
  ('Data centre or server room', 'Fire system', 'Puts out a fire without harming the equipment.', 3),
  ('Data centre or server room', 'UPS and power', 'Keeps the power on during a power cut.', 4),
  ('IP phone and PBX', 'Entry level IP phone', 'Basic phone for general staff.', 1),
  ('IP phone and PBX', 'Mid level IP phone', 'Extra keys. For managers.', 2),
  ('IP phone and PBX', 'High level IP phone', 'Colour screen and video calls. For top managers and reception.', 3),
  ('IP phone and PBX', 'IP PBX', 'The phone system that connects all the phones.', 4),
  ('Video conferencing', 'Meeting room system', 'Camera and speaker for a small meeting room.', 1),
  ('Video conferencing', 'Board room system', 'For large rooms. Up to 25 people.', 2),
  ('Video conferencing', 'Meeting software licence', 'Online meeting software, like Zoom.', 3),
  ('CCTV', 'IP camera', 'A camera on the network.', 1),
  ('CCTV', 'NVR', 'Records and keeps the camera video.', 2),
  ('CCTV', 'Video analytics', 'Finds people, cars or events in the video.', 3),
  ('Access control and attendance', 'Card', 'Opens with an ID card.', 1),
  ('Access control and attendance', 'Finger', 'Opens with a fingerprint.', 2),
  ('Access control and attendance', 'Face', 'Opens with a face scan.', 3),
  ('Network security', 'Next-Gen Firewall', 'Safe gateway. Blocks attacks, bad sites and malware. 250 to 500 or more users.', 1),
  ('Network security', 'NAC', 'Controls which users and devices can join the network.', 2),
  ('Network security', 'Anti-DDoS', 'Stops floods of traffic. 5 to 100 Gbps or more.', 3),
  ('Network security', 'SASE', 'Security for remote users, from the cloud.', 4),
  ('User and endpoint security', 'PAM', 'Controls admin passwords and admin access.', 1),
  ('User and endpoint security', 'MFA', 'A second check at sign in, like a code on the phone.', 2),
  ('User and endpoint security', 'EDR + MDR', 'Finds and stops attacks on PCs. Watched 24/7.', 3),
  ('User and endpoint security', 'Email security', 'Stops spam, phishing and malware in email.', 4),
  ('User and endpoint security', 'Antivirus', 'Basic protection on each PC.', 5),
  ('User and endpoint security', 'DLP', 'Stops company data from leaking out.', 6),
  ('App and API security', 'Load balancer and WAF', 'Shares the load and protects web apps.', 1),
  ('App and API security', 'DNS and GSLB', 'Keeps sites reachable. Moves traffic if a site fails.', 2),
  ('App and API security', 'API gateway', 'Controls and protects APIs.', 3),
  ('App and API security', 'Gateway API L7 and WAF', 'Protects apps that run in Kubernetes.', 4),
  ('AI and SOC', 'AI and LLM security', 'Protects AI apps from attacks and misuse.', 1),
  ('AI and SOC', 'SIEM', 'Collects and checks logs from all systems.', 2),
  ('AI and SOC', 'SOAR', 'Answers alerts by itself.', 3),
  ('AI and SOC', 'SOC', 'A team that watches security 24/7.', 4),
  ('Business software', 'Microsoft 365', NULL, 1),
  ('Business software', 'Google Workspace', NULL, 2),
  ('Business software', 'ERP', 'Software that runs the business: accounts, stock, sales.', 3),
  ('Business software', 'Other licences', 'Any other software they pay for.', 4),
  ('App care', 'VAPT', 'Tests apps and systems for security holes.', 1),
  ('App care', 'Load test', 'Tests an app under heavy use.', 2),
  ('App care', 'App migration', 'Moves apps and data to a new place.', 3),
  ('App care', 'Custom app development', 'Web, mobile and business apps made for them.', 4),
  ('SSL certificate', 'Single', 'One domain name.', 1),
  ('SSL certificate', 'Wildcard', 'One domain and all its sub-domains.', 2),
  ('SSL certificate', 'Multi-domain', 'Many domain names on one certificate.', 3),
  ('Managed services', 'AMC', 'Yearly maintenance contract.', 1),
  ('Managed services', 'Managed cloud', 'We run their cloud for them.', 2),
  ('Managed services', 'IT support', 'Help desk and on-site support.', 3);

INSERT INTO "HeatmapProduct" ("id", "groupId", "title", "position", "updatedAt")
SELECT gen_random_uuid(), g."id", s.title, s.position, now()
FROM heatmap_seed_product s JOIN "HeatmapGroup" g ON g."title" = s.group_title;

INSERT INTO "HeatmapPart" ("id", "productId", "title", "note", "position", "updatedAt")
SELECT gen_random_uuid(), p."id", s.title, s.note, s.position, now()
FROM heatmap_seed_part s JOIN "HeatmapProduct" p ON p."title" = s.product_title;

-- ── Old answers: Need it -> GREEN, No need -> RED with its reason ────────────
INSERT INTO "SalesAccountHeatmapPick" ("id", "salesAccountId", "productId", "colour", "reason", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), n."salesAccountId", p."id",
       CASE n."need" WHEN 'NEED' THEN 'GREEN'::"HeatmapPickColour" ELSE 'RED'::"HeatmapPickColour" END,
       CASE n."need" WHEN 'NO_NEED' THEN n."reason" ELSE NULL END,
       n."updatedBy", n."createdAt", n."updatedAt"
FROM "SalesAccountHeatmapNeed" n
JOIN heatmap_seed_product s ON s.legacy_key = n."card"
JOIN "HeatmapProduct" p ON p."title" = s.title;

DROP TABLE heatmap_seed_part;
DROP TABLE heatmap_seed_product;

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapItem" DROP CONSTRAINT "SalesAccountHeatmapItem_salesAccountId_fkey";

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapNeed" DROP CONSTRAINT "SalesAccountHeatmapNeed_salesAccountId_fkey";

-- DropTable
DROP TABLE "SalesAccountHeatmapItem";

-- DropTable
DROP TABLE "SalesAccountHeatmapNeed";

-- DropEnum
DROP TYPE "HeatmapNeed";
