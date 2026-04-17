# Prophet Lambda container image
# Base: AWS Lambda Python 3.11 — supports up to 10 GB, solves the 250 MB zip limit
FROM public.ecr.aws/lambda/python:3.11

# System deps required by Prophet / pystan
RUN dnf install -y gcc gcc-c++ make && dnf clean all

# Copy and install Python dependencies
COPY requirements_lambda.txt .
RUN pip install --no-cache-dir -r requirements_lambda.txt

# Copy the venuescope core package
COPY venuescope/ /var/task/venuescope/

# Copy Lambda handler files
COPY infrastructure/forecast/forecast_training_handler.py  /var/task/forecast_training_handler.py
COPY infrastructure/forecast/forecast_serving_handler.py   /var/task/forecast_serving_handler.py
COPY infrastructure/forecast/kalman_live_handler.py        /var/task/kalman_live_handler.py

WORKDIR /var/task
ENV PYTHONPATH=/var/task/venuescope

# Default handler — overridden per Lambda function config
CMD ["forecast_serving_handler.handler"]
