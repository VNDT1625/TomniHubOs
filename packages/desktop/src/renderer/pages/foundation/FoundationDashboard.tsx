import React, { useState } from 'react';
import {
  Card,
  Button,
  Input,
  Tag,
  Typography,
  Space,
  Grid,
  Tabs,
  Form,
  Message,
  Table,
  Badge,
} from '@arco-design/web-react';
import {
  Play,
  Shield,
  Cpu,
  User,


  Refresh,
} from '@icon-park/react';

const { Title, Text, Paragraph } = Typography;
const { Row, Col } = Grid;
const TabPane = Tabs.TabPane;

export const FoundationDashboard: React.FC = () => {
  // RunKernel State
  const [goal, setGoal] = useState('Build feature using 3-Core Foundation');
  const [surface, setSurface] = useState('chat');
  const [workspace, setWorkspace] = useState('C:/workspace/project');
  const [running, setRunning] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);

  // Security Core State
  const [inspectText, setInspectText] = useState('Sample API_KEY=sk-test1234567890abcdef');
  const [inspectResult, setInspectResult] = useState<string>('');

  // Efficiency Core State
  const [cpuUsage, setCpuUsage] = useState<number>(45);

  // User Understanding State
  const [prefKey, setPrefKey] = useState('editor');
  const [prefValue, setPrefValue] = useState('vscode');
  const [prefList, setPrefList] = useState<{ key: string; value: string; scope: string }[]>([
    { key: 'editor', value: 'vscode', scope: 'global' },
    { key: 'language', value: 'vi-VN', scope: 'global' },
  ]);

  // Handle RunKernel Execution
  const handleExecuteRun = async () => {
    setRunning(true);
    try {
      const intent = {
        runId: `run_${Date.now()}`,
        rootTaskId: `task_root_${Date.now()}`,
        surface,
        goal,
        constraints: ['safe_only'],
        successCriteria: ['completed'],
        workspaceScope: workspace,
        userId: 'user_gui',
        createdAt: Date.now(),
        correlationId: `corr_${Date.now()}`,
        policyVersion: '1.0.0',
      };

      const candidates = [
        { id: 'agent_primary', factors: { speed: 0.9, accuracy: 0.95 } },
        { id: 'agent_fallback', factors: { speed: 0.6, accuracy: 0.8 } },
      ];

      const api = (window as any).electronAPI;
      if (api?.executeFoundationRun) {
        const res = await api.executeFoundationRun({ intent, candidates });
        if (res?.success) {
          setLastReceipt(res.receipt);
          Message.success('RunKernel executed successfully!');
          const evtRes = await api.getFoundationEvents(intent.runId);
          if (evtRes?.success) setEvents(evtRes.events);
        } else {
          Message.error(`RunKernel failed: ${res?.error}`);
        }
      } else {
        // Fallback for non-electron env
        setLastReceipt({
          receiptId: `rcpt_mock_${Date.now()}`,
          runId: intent.runId,
          status: 'verified',
          createdAt: Date.now(),
        });
        Message.info('Executed in browser mock mode');
      }
    } catch (err) {
      Message.error(`Execution error: ${String(err)}`);
    } finally {
      setRunning(false);
    }
  };

  const handleAddPreference = () => {
    if (!prefKey || !prefValue) return;
    setPrefList((prev) => [...prev.filter((p) => p.key !== prefKey), { key: prefKey, value: prefValue, scope: 'global' }]);
    setPrefKey('');
    setPrefValue('');
    Message.success('Preference added');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <Title heading={3}>
        <Space>
          <Cpu theme="outline" size="28" fill="#165DFF" />
          TomniHubOS 3-Core Foundation Dashboard
        </Space>
      </Title>
      <Paragraph type="secondary">
        Quản lý và theo dõi trực quan RunKernel, Security Core, Efficiency Core và User Understanding Core.
      </Paragraph>

      <Tabs defaultActiveTab="runkernel" type="card">
        {/* RunKernel Tab */}
        <TabPane
          key="runkernel"
          title={
            <span>
              <Play theme="outline" size="16" style={{ marginRight: 6 }} />
              Run Kernel Executor
            </span>
          }
        >
          <Row gutter={16}>
            <Col span={12}>
              <Card title="Khởi Tạo Task RunIntent">
                <Form layout="vertical">
                  <Form.Item label="Goal (Mục tiêu)">
                    <Input value={goal} onChange={setGoal} placeholder="Nhập mục tiêu..." />
                  </Form.Item>
                  <Form.Item label="Surface">
                    <Input value={surface} onChange={setSurface} />
                  </Form.Item>
                  <Form.Item label="Workspace Scope">
                    <Input value={workspace} onChange={setWorkspace} />
                  </Form.Item>
                  <Button
                    type="primary"
                    icon={<Play theme="outline" />}
                    loading={running}
                    onClick={handleExecuteRun}
                    style={{ width: '100%' }}
                  >
                    Chạy RunKernel
                  </Button>
                </Form>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="Biên Nhận OutcomeReceipt">
                {lastReceipt ? (
                  <div>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div>
                        <Text bold>Status: </Text>
                        <Tag color={lastReceipt.status === 'verified' ? 'green' : 'red'}>
                          {lastReceipt.status.toUpperCase()}
                        </Tag>
                      </div>
                      <div>
                        <Text bold>Receipt ID: </Text>
                        <Text code>{lastReceipt.receiptId}</Text>
                      </div>
                      <div>
                        <Text bold>Run ID: </Text>
                        <Text code>{lastReceipt.runId}</Text>
                      </div>
                    </Space>
                  </div>
                ) : (
                  <Text type="secondary">Chưa có lượt chạy nào.</Text>
                )}
              </Card>

              {events.length > 0 && (
                <Card title="Event Log (Append-only)" style={{ marginTop: '16px' }}>
                  <Table
                    size="small"
                    pagination={{ pageSize: 5 }}
                    columns={[
                      { title: 'Seq', dataIndex: 'sequence', width: 60 },
                      { title: 'Type', dataIndex: 'eventType' },
                    ]}
                    data={events}
                    rowKey="eventId"
                  />
                </Card>
              )}
            </Col>
          </Row>
        </TabPane>

        {/* Security Core Tab */}
        <TabPane
          key="security"
          title={
            <span>
              <Shield theme="outline" size="16" style={{ marginRight: 6 }} />
              Security Core
            </span>
          }
        >
          <Card title="Kiểm Tra An Toàn Văn Bản Outbound">
            <Form layout="vertical">
              <Form.Item label="Văn bản cần kiểm tra">
                <Input.TextArea
                  rows={4}
                  value={inspectText}
                  onChange={setInspectText}
                  placeholder="Nhập văn bản..."
                />
              </Form.Item>
              <Button
                type="primary"
                icon={<Shield theme="outline" />}
                onClick={() => {
                  if (inspectText.includes('sk-')) {
                    setInspectResult('Sanitized: Secret detected and redacted.');
                  } else {
                    setInspectResult('Allowed: No sensitive findings detected.');
                  }
                }}
              >
                Kiểm tra Security Gate
              </Button>
            </Form>

            {inspectResult && (
              <div style={{ marginTop: '16px' }}>
                <Text bold>Kết quả: </Text>
                <Tag color={inspectResult.startsWith('Sanitized') ? 'gold' : 'green'}>
                  {inspectResult}
                </Tag>
              </div>
            )}
          </Card>
        </TabPane>

        {/* Efficiency Core Tab */}
        <TabPane
          key="efficiency"
          title={
            <span>
              <Cpu theme="outline" size="16" style={{ marginRight: 6 }} />
              Efficiency Core
            </span>
          }
        >
          <Row gutter={16}>
            <Col span={12}>
              <Card title="Pressure Sampler & Concurrency">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <div>
                    <Text bold>CPU Usage Simulator: </Text>
                    <Input
                      type="number"
                      value={String(cpuUsage)}
                      onChange={(val) => setCpuUsage(Number(val))}
                    />
                  </div>
                  <div>
                    <Text bold>Áp Lực Tài Nguyên: </Text>
                    <Tag color={cpuUsage > 90 ? 'red' : cpuUsage > 70 ? 'gold' : 'green'}>
                      {cpuUsage > 90 ? 'CRITICAL' : cpuUsage > 70 ? 'CONSTRAINED' : 'HEALTHY'}
                    </Tag>
                  </div>
                  <div>
                    <Text bold>Effective Concurrency Limit: </Text>
                    <Badge
                      count={cpuUsage > 90 ? 3 : cpuUsage > 70 ? 6 : 10}
                      style={{ backgroundColor: cpuUsage > 90 ? '#F53F3F' : '#165DFF' }}
                    />
                  </div>
                </Space>
              </Card>
            </Col>

            <Col span={12}>
              <Card title="Choice Advisor (Rule-First Candidate Ranking)">
                <Paragraph>
                  Candidate: <Text code>agent_primary</Text> (Score: 1.85) $\rightarrow$ <Tag color="green">SELECTED</Tag>
                </Paragraph>
                <Paragraph>
                  Candidate: <Text code>agent_fallback</Text> (Score: 1.40) $\rightarrow$ <Tag color="arcoblue">AVAILABLE</Tag>
                </Paragraph>
              </Card>
            </Col>
          </Row>
        </TabPane>

        {/* User Understanding Tab */}
        <TabPane
          key="user_understanding"
          title={
            <span>
              <User theme="outline" size="16" style={{ marginRight: 6 }} />
              User Understanding Core
            </span>
          }
        >
          <Card title="Quản Lý Preference Người Dùng">
            <Form layout="inline" style={{ marginBottom: '16px' }}>
              <Form.Item label="Key">
                <Input value={prefKey} onChange={setPrefKey} placeholder="key" />
              </Form.Item>
              <Form.Item label="Value">
                <Input value={prefValue} onChange={setPrefValue} placeholder="value" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" onClick={handleAddPreference}>
                  Thêm / Xác Nhận
                </Button>
              </Form.Item>
            </Form>

            <Table
              size="small"
              columns={[
                { title: 'Key', dataIndex: 'key' },
                { title: 'Value', dataIndex: 'value' },
                { title: 'Scope', dataIndex: 'scope' },
              ]}
              data={prefList}
              rowKey="key"
            />
          </Card>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default FoundationDashboard;
