$apiKey = "abc_prod_KHLctm3KETU0cWeLeSbdTkEX";

curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Content-Type: application/json",
    "Authorization: Bearer $apiKey"
]);
