#!/bin/bash

echo "🔄 current code backup to github....."
echo "------------------------------------------------"

git add .

commitMessage="Auto Code Backup: $(date +'%d-%m-%Y %I:%M %p')"
git commit -m "$commitMessage"

echo "🚀 data uploading..."
git push origin main

echo "------------------------------------------------"
echo "✅ $commitMessage Now Update is Complete!"