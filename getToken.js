const axios = require("axios");

async function getRefreshToken() {
  const url = "https://accounts.zoho.sa/oauth/v2/token";

  // താഴെ പറയുന്ന വിവരങ്ങൾ നിങ്ങളുടെ Zoho കൺസോളിൽ നിന്നും ലഭിച്ചവ ഉപയോഗിച്ച് മാറ്റുക
  const params = new URLSearchParams({
    code: "1000.e729212f5bd987fb5ecba33730b286cb.83cbe339848708f4e0f3a9ab6b803511", // ഇവിടെ 3 മിനിറ്റ് കാലാവധിയുള്ള Grant Token നൽകുക
    client_id: "1000.36EUB4FSPFEAFNQZ9HHHT6UXYV32RK", // ഇവിടെ Client ID നൽകുക
    client_secret: "dc76a4bca8e6634fdd78279f66a13cea2f696fc5f0", // ഇവിടെ Client Secret നൽകുക
    grant_type: "authorization_code",
  });

  try {
    const response = await axios.post(url, params);
    console.log("Success! ഇതാ നിങ്ങളുടെ ടോക്കൺ വിവരങ്ങൾ:");
    console.log(response.data);
    // ലഭിക്കുന്ന റിസൾട്ടിൽ നിന്നും 'refresh_token' കോപ്പി ചെയ്തു വെക്കുക
  } catch (error) {
    console.error(
      "Error:",
      error.response ? error.response.data : error.message,
    );
  }
}

getRefreshToken();
