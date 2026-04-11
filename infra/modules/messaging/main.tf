resource "aws_sqs_queue" "health_dlq" {
  name                      = "${var.project_name}-health-events-dlq-${var.environment}"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "health" {
  name                       = "${var.project_name}-health-events-${var.environment}"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.health_dlq.arn
    maxReceiveCount     = 3
  })
}

data "aws_iam_policy_document" "health_queue_policy" {
  statement {
    sid     = "AllowLambdaSend"
    effect  = "Allow"
    actions = ["sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }

    resources = [aws_sqs_queue.health.arn]
  }
}

resource "aws_sqs_queue_policy" "health" {
  queue_url = aws_sqs_queue.health.id
  policy    = data.aws_iam_policy_document.health_queue_policy.json
}
