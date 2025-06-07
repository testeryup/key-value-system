# Hệ Thống Key-Value Phân Tán

Một hệ thống key-value store phân tán được xây dựng bằng Node.js và gRPC, hỗ trợ load balancing, replication và failover tự động.

## 📋 Mục Lục

- [Tổng Quan](#tổng-quan)
- [Kiến Trúc Hệ Thống](#kiến-trúc-hệ-thống)
- [Cài Đặt](#cài-đặt)
- [Khởi Chạy Hệ Thống](#khởi-chạy-hệ-thống)
- [Sử Dụng Client](#sử-dụng-client)
- [API Reference](#api-reference)
- [Cấu Trúc Dữ Liệu](#cấu-trúc-dữ-liệu)
- [Kiểm Thử](#kiểm-thử)
- [Troubleshooting](#troubleshooting)

## 🎯 Tổng Quan

Hệ thống này bao gồm:
- **3 KV Nodes**: Lưu trữ dữ liệu với replication tự động (ports 50051, 50052, 50053)
- **2 Load Balancers**: Primary/Secondary với failover tự động (shared port 60051)
- **1 Client**: Giao diện CLI đơn giản

### Đặc Điểm Chính
- ✅ **Replication**: Dữ liệu tự động đồng bộ giữa 3 nodes
- ✅ **Load Balancing**: Round-robin distribution
- ✅ **High Availability**: Primary/Secondary LB với shared port competition
- ✅ **Persistence**: Lưu vào JSON files với timestamp
- ✅ **Health Monitoring**: Tự động phát hiện node failure

## 🏗️ Kiến Trúc Hệ Thống

```
┌─────────────┐    ┌──────────────────┐    ┌─────────────┐
│   Client    │───▶│  Load Balancer   │───▶│   KV Node   │
│   :60051    │    │ Shared Port:60051│    │   kv1:50051 │
└─────────────┘    │Primary:60061     │    │   kv2:50052 │
                   │Secondary:60062   │    │   kv3:50053 │
                   └──────────────────┘    └─────────────┘
                            │                     │
                            ▼                     ▼
                   ┌──────────────────┐    ┌─────────────┐
                   │ Health Checking  │    │ Replication │
                   │ & Failover       │    │ PUT/DELETE  │
                   └──────────────────┘    └─────────────┘
```

## 📦 Cài Đặt

### Yêu Cầu Hệ Thống
- Node.js >= 14.0.0
- npm >= 6.0.0

### Cài đặt dependencies
```bash
npm install
```

### Cấu trúc thư mục hiện tại
```
key-value-system/
├── single-node.js          # KV Node (3 instances)
├── load-balancer.js        # Load Balancer (Primary/Secondary)
├── client.js               # CLI Client
├── single-node.proto       # gRPC cho KV nodes
├── load-balancer.proto     # gRPC cho Load Balancer
├── package.json            # Dependencies & scripts
├── kv1-db.json            # Database node 1
├── kv2-db.json            # Database node 2
├── kv3-db.json            # Database node 3
└── README.md
```

## 🚀 Khởi Chạy Hệ Thống

### Mở 5 terminals và chạy:

**Terminal 1-3: KV Nodes**
```bash
npm run start:kv1    # Port 50051
npm run start:kv2    # Port 50052
npm run start:kv3    # Port 50053
```

**Terminal 4-5: Load Balancers**
```bash
npm run start:lb-primary      # Shared port 60051, coord 60061
npm run start:lb-secondary    # Shared port 60051, coord 60062
```

### Kiểm tra hệ thống khởi động thành công:
```
[kv1] KV Node started on port 50051
[kv2] KV Node started on port 50052
[kv3] KV Node started on port 50053
[LoadBalancer-primary] 🎯 CAPTURED shared port 60051
[LoadBalancer-primary] 🟢 ACTIVE on port 60051
```

## 💻 Sử Dụng Client

### Chế Độ Interactive
```bash
node client.js
```

CLI Interface:
```
🔑 KV Store Client
Commands: get <key> | put <key> <value> | delete <key> | status | exit

kv> put user:1 "Nguyễn Văn A"
OK

kv> get user:1
"Nguyễn Văn A"

kv> delete user:1
OK

kv> status
Active: true, Mode: primary, Healthy: 3/3

kv> exit
Bye!
```

### Chế Độ Single Command
```bash
node client.js put mykey "myvalue"    # Output: OK
node client.js get mykey              # Output: myvalue
node client.js delete mykey           # Output: OK
node client.js status                 # Output: Active: true, Mode: primary, Healthy: 3/3
```

## 📚 API Reference

### Client Commands
| Command | Description | Example |
|---------|-------------|---------|
| `get <key>` | Lấy giá trị | `get user:123` |
| `put <key> <value>` | Lưu dữ liệu | `put user:123 "John"` |
| `delete <key>` | Xóa key | `delete user:123` |
| `status` | Trạng thái LB | `status` |
| `exit` | Thoát | `exit` |

### gRPC Services

**KV Node Service (single-node.proto)**
```protobuf
service KeyValueService {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
    rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
    rpc Replicate(ReplicateRequest) returns (ReplicateResponse);
}
```

**Load Balancer Service (load-balancer.proto)**
```protobuf
service LoadBalancerService {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
    rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
    rpc GetStatus(GetStatusRequest) returns (GetStatusResponse);
}
```

## 💾 Cấu Trúc Dữ Liệu

### Database Files Format
```json
{
  "yo": {
    "value": "321",
    "timestamp": 1749290507629
  }
}
```

**Giải thích:**
- **key**: `"yo"` - Tên key
- **value**: `"321"` - Giá trị được lưu
- **timestamp**: `1749290507629` - Unix timestamp khi tạo/update

### Replication Flow
1. Client gửi PUT/DELETE tới Load Balancer
2. Load Balancer forward tới 1 KV node
3. KV node xử lý và gọi `replicateToOthers()`
4. Replicate tới 2 nodes còn lại qua gRPC `Replicate`
5. Tất cả nodes có dữ liệu giống nhau

## 🧪 Kiểm Thử

### Test Replication
```bash
# Terminal client
node client.js
kv> put test_key "test_value"

# Kiểm tra 3 files
cat kv1-db.json  # Có data
cat kv2-db.json  # Có data giống
cat kv3-db.json  # Có data giống
```

### Test Load Balancer Failover
```bash
# 1. Chạy cả 2 LBs
npm run start:lb-primary      # Terminal 4
npm run start:lb-secondary    # Terminal 5

# 2. Kill primary (Ctrl+C terminal 4)
# 3. Secondary sẽ capture port 60051
# 4. Client vẫn hoạt động bình thường

# 5. Restart primary - sẽ reclaim port
npm run start:lb-primary
```

### Test Node Failure
```bash
# 1. Kill kv2 (Ctrl+C)
# 2. Load balancer tự động loại kv2 khỏi rotation
# 3. Requests chỉ tới kv1 và kv3
# 4. Restart kv2 - tự động được thêm lại
npm run start:kv2
```

## 🔧 Configuration

### Ports
| Component | Port | Configurable |
|-----------|------|--------------|
| kv1 | 50051 | ✅ |
| kv2 | 50052 | ✅ |
| kv3 | 50053 | ✅ |
| LB Shared | 60051 | ✅ |
| LB Primary Coord | 60061 | ✅ |
| LB Secondary Coord | 60062 | ✅ |