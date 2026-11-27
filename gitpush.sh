#!/bin/bash

echo "🔄 Starting current code backup to GitHub..."
echo "------------------------------------------------"

# Ensure safe directory for root/other users
git config --global --add safe.directory /home/fefei/ERP_System 2>/dev/null

git add . || { echo "❌ Git add failed!"; exit 1; }

# Prompt the user for a commit message
read -p "📝 Enter your commit message (or press Enter for default): " userComment

# Set a default message if the user leaves it blank
if [ -z "$userComment" ]; then
    userComment="Auto Code Backup"
fi

# Append the current date and time to the message
commitMessage="$userComment : $(date +'%d-%m-%Y %I:%M %p')"

git commit -m "$commitMessage"

echo "🚀 Uploading data to GitHub..."
git checkout -B main || { echo "❌ Branch switch failed!"; exit 1; }

if git push --force origin main; then
    echo "------------------------------------------------"
    echo "✅ '$commitMessage' - Update is Complete!"
else
    echo "------------------------------------------------"
    echo "❌ Git Push Failed! Please check your connection or GitHub credentials."
    exit 1
fi