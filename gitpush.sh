#!/bin/bash

echo "🔄 Starting current code backup to GitHub..."
echo "------------------------------------------------"

git add .

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
git push origin main

echo "------------------------------------------------"
echo "✅ '$commitMessage' - Update is Complete!"