<?php
// permitir requisições do seu site
header("Access-Control-Allow-Origin: *");
header("Content-Type: application/json");

// pegar dados enviados
$input = json_decode(file_get_contents('php://input'), true);

$nome = $input['nome'] ?? '';
$telefone = $input['telefone'] ?? '';
$valor = $input['valor'] ?? 0.00;

// chave Abacate Pay (sua chave Pix)
$chavePix = "abc_prod_KHLctm3KETU0cWeLeSbdTkEX"; 

// gerar cobrança Pix via API Abacate Pay (exemplo simplificado)
$payload = [
    "chave" => $chavePix,
    "valor" => $valor,
    "descricao" => "Bolão Mega da Virada 2025 - $nome",
    "nome_cliente" => $nome,
    "telefone_cliente" => $telefone
];

// URL de criação de Pix (exemplo Abacate Pay)
$url = "https://api.abacatepay.com/v1/pixQrCode/create"; // substitua pela URL real

$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));

$result = curl_exec($ch);
if(curl_errno($ch)){
    echo json_encode(["success"=>false,"error"=>curl_error($ch)]);
    exit;
}
curl_close($ch);

// decodificar resposta
$resposta = json_decode($result, true);

// retornar código Pix
if(isset($resposta['pix'])){
    echo json_encode(["success"=>true,"pix"=>$resposta['pix']]);
} else {
    echo json_encode(["success"=>false,"error"=>"Não foi possível gerar o Pix"]);
}>
