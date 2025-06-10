# Nhóm 4 - Ứng dụng Phân tán N03
## Thành viên
- Nguyễn Mạnh Đạt
- Đỗ Huy Dương

# Hệ Thống Key-Value Phân Tán

Một hệ thống key-value store phân tán được xây dựng bằng Node.js và gRPC, hỗ trợ load balancing, replication và failover tự động.

## 🎯 Đáp Ứng Các Tiêu Chí Hệ Phân Tán

### ✅ **Scalability (Khả năng mở rộng)**
- **Horizontal scaling**: Có thể thêm nhiều node (hiện tại: 3 node)
- **Load balancing**: Round-robin phân phối yêu cầu qua Load Balancer
- **Stateless architecture**: Mỗi node độc lập, không phụ thuộc state của nhau

### ✅ **High Availability (Tính sẵn sàng cao)**  
- **No single point of failure**: 
  - 3 KV nodes với replication
  - 2 Load Balancers với failover tự động
- **Fault tolerance**: Hệ thống hoạt động khi 1-2 nodes down
- **Primary/Secondary LB**: Automatic failover khi Primary LB crash
- **Graceful degradation**: Performance giảm nhưng hệ thống vẫn hoạt động

### ✅ **Consistency (Tính nhất quán)**
- **Eventual consistency**: Thông qua replication mechanism  
- **Conflict resolution**: Timestamp-based (newer wins)
- **Atomic operations**: Mỗi PUT/DELETE được replicate đầy đủ
- **Node recovery sync**: Copy toàn bộ data từ node mới nhất

### ✅ **Partition Tolerance (Chịu đựng phân vùng mạng)**
- **Network partition handling**: Nodes hoạt động độc lập khi mất kết nối
- **Recovery mechanism**: Tự động đồng bộ khi khởi động lại
- **Timeout & retry**: Health check với timeout, retry mechanism

### ✅ **Reliability (Độ tin cậy)**
- **Data persistence**: Lưu vào JSON files với timestamp
- **Replication factor 3**: Mỗi data có 3 copies
- **Health monitoring**: Kiểm tra tình trạng các node liên tục (5s interval)
- **Automatic recovery**: Node tự động rejoin cluster sau restart

### ✅ **Performance (Hiệu năng)**
- **Load balancing**: Yêu cầu được phân phối qua các node
- **Asynchronous operations**: Non-blocking gRPC calls
- **Connection pooling**: Tái sử dụng gRPC clients
- **Efficient data format**: JSON 

## 📊 **CAP Theorem Analysis**

Hệ thống thiên về **AP** (Availability + Partition Tolerance):

```
CAP Theorem Trade-offs:
┌─────────────────┐
│   Consistency   │ ⚖️  Eventually Consistent
│                 │     (giải pháp dựa trên timestamp)
├─────────────────┤
│  Availability   │ ✅  High (nhiều nodes + LB failover)
│                 │     
├─────────────────┤  
│Partition        │ ✅  Tolerant (các node hoạt động độc lập)
│Tolerance        │     (tự hồi phục khi sống dậy)
└─────────────────┘
```

## 📋 Mục Lục

- Tổng Quan
- Kiến Trúc Hệ Thống
- Cài Đặt
- Khởi Chạy Hệ Thống
- Sử Dụng Client
- API Reference
- Cấu Trúc Dữ Liệu
- Tính Năng Đồng Bộ
- Kiểm Thử
- Troubleshooting

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
- ✅ **Node Recovery**: Copy toàn bộ data từ node mới nhất khi restart
- ✅ **Conflict Resolution**: Timestamp-based với savedAt comparison

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
                   │ & Failover       │    │ & Sync      │
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
├── single-node.js          # KV Node với sync capability
├── load-balancer.js        # Load Balancer (Primary/Secondary)
├── client.js               # CLI Client
├── single-node.proto       # gRPC cho KV nodes (có GetNodeInfo, CopyAllData)
├── load-balancer.proto     # gRPC cho Load Balancer
├── package.json            # Dependencies & scripts
├── kv1-db.json            # Database node 1 (có savedAt)
├── kv2-db.json            # Database node 2 (có savedAt)
├── kv3-db.json            # Database node 3 (có savedAt)
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
[kv1] 🔄 Starting initial sync...
[kv1] ℹ️  Local data is up-to-date, no sync needed
[kv1] 🚀 Node ready to serve requests
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
| [get <key>](http://_vscodecontentref_/3) | Lấy giá trị | `get user:123` |
| [put <key> <value>](http://_vscodecontentref_/4) | Lưu dữ liệu | `put user:123 "John"` |
| [delete <key>](http://_vscodecontentref_/5) | Xóa key | `delete user:123` |
| [status](http://_vscodecontentref_/6) | Trạng thái LB | [status](http://_vscodecontentref_/7) |
| [exit](http://_vscodecontentref_/8) | Thoát | [exit](http://_vscodecontentref_/9) |

### gRPC Services

**KV Node Service (single-node.proto)**
```protobuf
service KeyValueService {
    rpc Get(GetRequest) returns (GetResponse);
    rpc Put(PutRequest) returns (PutResponse);
    rpc Delete(DeleteRequest) returns (DeleteResponse);
    rpc HealthCheck(HealthCheckRequest) returns (HealthCheckResponse);
    rpc Replicate(ReplicateRequest) returns (ReplicateResponse);
    rpc GetNodeInfo(GetNodeInfoRequest) returns (GetNodeInfoResponse);
    rpc CopyAllData(CopyAllDataRequest) returns (CopyAllDataResponse);
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
  "data": {
    "yolo": {
      "value": "321",
      "timestamp": 1749449729077
    },
    "uchi": {
      "value": "haha",
      "timestamp": 1749449733349
    },
    "hee": {
      "value": "123",
      "timestamp": 1749449749883
    },
    "jiji": {
      "value": "321",
      "timestamp": 1749449754588
    }
  },
  "savedAt": 1749449779742
}
```

**Giải thích:**
- **data**: Object chứa tất cả key-value pairs
- **key**: Tên key (vd: "yolo")
- **value**: Giá trị được lưu (vd: "321")  
- **timestamp**: Unix timestamp khi tạo/update key đó
- **savedAt**: Timestamp khi toàn bộ database được save (dùng để sync)

### Replication Flow
1. Client gửi PUT/DELETE tới Load Balancer
2. Load Balancer forward tới 1 KV node
3. KV node xử lý, update [savedAt](http://_vscodecontentref_/10) và save to disk
4. Replicate tới 2 nodes còn lại qua gRPC [Replicate](http://_vscodecontentref_/11)
5. Tất cả nodes có dữ liệu giống nhau

## 🔄 Tính Năng Đồng Bộ

### Initial Sync khi Node Restart (Simplified)
Khi một node khởi động lại, nó sẽ:

1. **Load dữ liệu local** và [savedAt](http://_vscodecontentref_/12) timestamp
2. **Check metadata** từ các nodes khác qua [GetNodeInfo](http://_vscodecontentref_/13)
3. **So sánh savedAt**: Nếu có node có [savedAt](http://_vscodecontentref_/14) mới hơn
4. **Copy toàn bộ data** từ node mới nhất qua [CopyAllData](http://_vscodecontentref_/15)
5. **Ready to serve** requests

```bash
# Log example khi node restart và cần sync
[kv2] 🔄 Starting initial sync...
[kv2] Current savedAt: 2024-01-12T10:20:30.000Z
[kv2] Checking kv1...
[kv2] Found newer data on kv1: 2024-01-12T10:25:30.000Z
[kv2] 📥 Copying all data from kv1...
[kv2] ✅ Successfully copied 4 keys from kv1
[kv2] 🚀 Node ready to serve requests
```

```bash
# Log example khi không cần sync
[kv1] 🔄 Starting initial sync...
[kv1] Current savedAt: 2024-01-12T10:25:30.000Z
[kv1] Checking kv2...
[kv1] Checking kv3...
[kv1] ℹ️  Local data is up-to-date, no sync needed
[kv1] 🚀 Node ready to serve requests
```

### Sync Algorithm
- **Tìm node mới nhất**: So sánh [savedAt](http://_vscodecontentref_/16) của tất cả nodes
- **Copy toàn bộ**: Nếu có node mới hơn → copy toàn bộ data
- **Conflict resolution**: Node có [savedAt](http://_vscodecontentref_/17) mới nhất thắng
- **DELETE handling**: Copy toàn bộ data → DELETE operations được reflect

### Protection During Sync
- **Reject requests** khi node đang sync: [isInitializing = true](http://_vscodecontentref_/18)
- **Return proper gRPC error**: [UNAVAILABLE](http://_vscodecontentref_/19) status  
- **Load balancer adapts**: Tự động route tới nodes khác

## 🧪 Kiểm Thử

### Test Replication
```bash
# Terminal client
node client.js
kv> put test_key "test_value"

# Kiểm tra 3 files có data giống nhau
type kv1-db.json  # Windows
type kv2-db.json  # Windows
type kv3-db.json  # Windows

# Hoặc Linux/Mac
cat kv1-db.json
cat kv2-db.json
cat kv3-db.json
```

### Test Node Recovery & Sync
```bash
# 1. Start tất cả nodes
npm run start:kv1
npm run start:kv2
npm run start:kv3
npm run start:lb-primary

# 2. Add data
node client.js put key1 "value1"
node client.js put key2 "value2"

# 3. Stop một node  
# Ctrl+C tại terminal kv2

# 4. Add thêm data khi kv2 down
node client.js put key3 "value3"
node client.js delete key1

# 5. Restart kv2 - sẽ thấy sync process
npm run start:kv2

# 6. Kiểm tra kv2 đã có đầy đủ data
node client.js get key3  # Should return "value3"
node client.js get key1  # Should return Không tìm thấy (đã bị xóa)
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

### Test Node Failure với Load Balancer
```bash
# 1. Kill kv2 (Ctrl+C)
# 2. Load balancer tự động loại kv2 khỏi rotation
# 3. Requests chỉ tới kv1 và kv3
# 4. Restart kv2 - tự động sync và được thêm lại
npm run start:kv2
```

### Test DELETE Sync (Quan trọng!)
```bash
# 1. Start tất cả nodes
npm run start:kv1
npm run start:kv2 
npm run start:kv3

# 2. Add data
node client.js put test_delete "will_be_deleted"

# 3. Verify data exists trên tất cả nodes
node client.js get test_delete  # "will_be_deleted"

# 4. Stop kv3
# Ctrl+C tại terminal kv3

# 5. Delete key khi kv3 down
node client.js delete test_delete

# 6. Verify deletion trên kv1, kv2
node client.js get test_delete  # Không tìm thấy

# 7. Restart kv3 - sẽ sync và DELETE được apply
npm run start:kv3

# 8. Check kv3 sau sync
node client.js get test_delete  # Không tìm thấy (DELETE được sync!)
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

### [Package.json](http://_vscodecontentref_/20) Scripts
```json
{
  "start:kv1": "node single-node.js 50051 kv1",
  "start:kv2": "node single-node.js 50052 kv2",
  "start:kv3": "node single-node.js 50053 kv3", 
  "start:lb-primary": "node load-balancer.js 60051 primary 60061",
  "start:lb-secondary": "node load-balancer.js 60051 secondary 60062"
}
```

### Sync Configuration (trong single-node.js)
```javascript
// Node configuration
this.healthCheckInterval = 5000; // 5 seconds
this.leaderElectionInterval = 2000; // 2 seconds
```

## 🐛 Troubleshooting

### Lỗi "EADDRINUSE"
```bash
# Kiểm tra port đang được sử dụng
netstat -ano | findstr :50051    # Windows
lsof -i :50051                   # Linux/Mac

# Kill process
taskkill /PID <PID> /F          # Windows
kill -9 <PID>                   # Linux/Mac
```

### Lỗi "No healthy nodes available"
```bash
# Kiểm tra nodes đang chạy
tasklist | findstr node         # Windows
ps aux | grep single-node      # Linux/Mac

# Restart thiếu nodes
npm run start:kv1
npm run start:kv2
npm run start:kv3
```

### Lỗi "Node is initializing"
```bash
# Node đang sync, chờ một chút
# Hoặc check logs để thấy sync progress
# Nếu bị stuck, restart node:
# Ctrl+C và npm run start:kvX
```

### Lỗi Client không connect được
```bash
# Test port 60051
telnet localhost 60051

# Restart load balancers
npm run start:lb-primary
npm run start:lb-secondary
```

### Health Check với gRPC

**Tạo file `health-check.js`:**
```javascript
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');

// Load proto
const kvProto = grpc.loadPackageDefinition(
    protoLoader.loadSync('./single-node.proto')
).keyvalue;

const lbProto = grpc.loadPackageDefinition(
    protoLoader.loadSync('./load-balancer.proto')
).loadbalancer;

// Check KV nodes
[50051, 50052, 50053].forEach(port => {
    const client = new kvProto.KeyValueService(
        `localhost:${port}`,
        grpc.credentials.createInsecure()
    );
    
    client.HealthCheck({}, (err, response) => {
        if (err) {
            console.log(`KV${port}: FAIL - ${err.message}`);
        } else {
            console.log(`KV${port}: OK (initializing: ${response.isInitializing})`);
        }
    });
});

// Check Load Balancer
const lbClient = new lbProto.LoadBalancerService(
    'localhost:60051',
    grpc.credentials.createInsecure()
);

lbClient.HealthCheck({}, (err, response) => {
    console.log(`LoadBalancer: ${err ? 'FAIL' : 'OK'}`);
});
```

```bash
node health-check.js
```

### Debug Sync Issues
```bash
# Check database files savedAt
type kv1-db.json | find "savedAt"   # Windows
grep "savedAt" kv1-db.json          # Linux/Mac

# Compare savedAt between nodes
echo "KV1 savedAt:" && node -e "console.log(new Date(JSON.parse(require('fs').readFileSync('kv1-db.json')).savedAt))"
echo "KV2 savedAt:" && node -e "console.log(new Date(JSON.parse(require('fs').readFileSync('kv2-db.json')).savedAt))"
echo "KV3 savedAt:" && node -e "console.log(new Date(JSON.parse(require('fs').readFileSync('kv3-db.json')).savedAt))"
```

### Data Consistency Check
```bash
# Quick script để check data consistency
echo "Checking data consistency..."
echo "KV1 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv1-db.json')).data))"
echo "KV2 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv2-db.json')).data))"
echo "KV3 keys:" && node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('kv3-db.json')).data))"

# Compare savedAt timestamps  
echo "KV1 savedAt:" && node -e "console.log(JSON.parse(require('fs').readFileSync('kv1-db.json')).savedAt)"
echo "KV2 savedAt:" && node -e "console.log(JSON.parse(require('fs').readFileSync('kv2-db.json')).savedAt)"
echo "KV3 savedAt:" && node -e "console.log(JSON.parse(require('fs').readFileSync('kv3-db.json')).savedAt)"
```

### Manual Sync Test
```bash
# Test GetNodeInfo manually
node -e "
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const kvProto = grpc.loadPackageDefinition(protoLoader.loadSync('./single-node.proto')).keyvalue;
const client = new kvProto.KeyValueService('localhost:50051', grpc.credentials.createInsecure());
client.GetNodeInfo({nodeId: 'test'}, (err, res) => console.log(err || res));
"
```

---

### 🚀 Quick Start
```bash
# Terminal 1-3: Start nodes (sẽ tự động sync nếu cần)
npm run start:kv1 & npm run start:kv2 & npm run start:kv3

# Terminal 4-5: Start load balancers
npm run start:lb-primary & npm run start:lb-secondary

# Terminal 6: Use client
node client.js
```

### 💡 Logic đồng bộ dữ liệu
- **Đơn giản**: Chỉ so sánh [savedAt](http://_vscodecontentref_/21) timestamp
- **Hiệu quả**: Copy toàn bộ data thay vì track operations
- **Đảm bảo consistency**: Node có [savedAt](http://_vscodecontentref_/22) mới nhất = source of truth
- **Handle DELETE**: Copy toàn bộ → DELETE operations được reflect correctly