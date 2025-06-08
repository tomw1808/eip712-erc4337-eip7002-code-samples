/**
 * Based on https://github.com/wevm/viem/tree/main/examples/account-abstraction_biconomy-bundler
 */
import { http, type Hex, createPublicClient, parseEther } from 'viem'
import {
  createBundlerClient,
  createPaymasterClient
} from 'viem/account-abstraction'
import { toSafeSmartAccount } from "permissionless/accounts"
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const PRIVATE_KEY="0x36faa8ac683b2ac54b2cb113b345107b790191014223478d786ed0c0786eedd9"; // == address: 0xdead4d073eb5a47ccae500a8bc01d1f473c60aa1

const CANDIDE_BUNDLER="https://api.candide.dev/bundler/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //hardcoded on purpose
const CANDIDE_PAYMASTER="https://api.candide.dev/paymaster/v3/sepolia/5bfc7f3150f9c9834d6b024261680726"; //paymaster sepolia hardcoded on purpose

const client = createPublicClient({
  chain: sepolia,
  transport: http(),
})

const owner = privateKeyToAccount(PRIVATE_KEY as Hex)

// Generate a Safe Smart Account so you can go to safe.global and access it from there
const account = await toSafeSmartAccount({
  client,
  owners: [owner],
  version: "1.4.1"
})

const paymasterClient = createPaymasterClient({
  transport: http(
    CANDIDE_PAYMASTER,
  ),
})

const bundlerClient = createBundlerClient({
chain: sepolia,
  account,
  client,
  transport: http(
    CANDIDE_BUNDLER,
  ),
  paymaster: paymasterClient,
//   paymasterContext: {
//     mode: 'SPONSORED',
//     calculateGasLimits: true,
//     expiryDuration: 300,
//     sponsorshipInfo: {
//       webhookData: {},
//       smartAccountInfo: {
//         name: 'BICONOMY',
//         version: '2.0.0',
//       },
//     },
//   },
})

console.log("Account: ", account.address);

const hash = await bundlerClient.sendUserOperation({
  calls: [
    // send 0.000001 ETH to self
    {
      to: account.address,
      value: parseEther('0.000001'),
    },
  ],
})
console.log(hash);