output "api_endpoint" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "api_endpoint_host" {
  value = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "")
}
