output "health_queue_url" {
  value = aws_sqs_queue.health.url
}

output "health_queue_arn" {
  value = aws_sqs_queue.health.arn
}

output "health_dlq_arn" {
  value = aws_sqs_queue.health_dlq.arn
}
