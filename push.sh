#!/bin/bash

echo "🔄 കോഡ് ഗിറ്റ്ഹബ്ബിലേക്ക് സേവ് ചെയ്യുന്നു..."
echo "------------------------------------------------"

git add .

commitMessage="Auto Code Backup: $(date +'%d-%m-%Y %I:%M %p')"
git commit -m "$commitMessage"

echo "🚀 ഗിറ്റ്ഹബ്ബിലേക്ക് അപ്‌ലോഡ് ചെയ്യുന്നു..."
git push origin main

echo "------------------------------------------------"
echo "✅ $commitMessage വിജയകരമായി സേവ് ചെയ്തു!"