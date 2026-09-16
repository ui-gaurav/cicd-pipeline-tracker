-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('STAGING', 'PRODUCTION');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repository" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "commitAuthor" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'STAGING',
    "status" TEXT NOT NULL,
    "logs" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repositoryId" TEXT NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoStats" (
    "id" TEXT NOT NULL,
    "totalCommits" INTEGER NOT NULL DEFAULT 0,
    "contributors" INTEGER NOT NULL DEFAULT 0,
    "primaryLanguage" TEXT,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repositoryId" TEXT NOT NULL,

    CONSTRAINT "RepoStats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Repository_owner_name_key" ON "Repository"("owner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RepoStats_repositoryId_key" ON "RepoStats"("repositoryId");

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoStats" ADD CONSTRAINT "RepoStats_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
