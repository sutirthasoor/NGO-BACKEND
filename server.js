const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Razorpay Instance
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ==================== ROUTES ====================

// Test Route
app.get('/', (req, res) => {
  res.json({ message: 'NGO Backend is running!' });
});

// Create Order
app.post('/api/create-order', async (req, res) => {
  try {
    const { amount, currency = 'INR', receipt, notes = {} } = req.body;

    // Validate
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    const options = {
      amount: amount * 100, // Convert to paise (1 INR = 100 paise)
      currency: currency,
      receipt: receipt || `receipt_${Date.now()}`,
      notes: {
        ...notes,
        timestamp: new Date().toISOString()
      },
      payment_capture: 1 // Auto-capture payment
    };

    const order = await razorpay.orders.create(options);

    res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID
    });

  } catch (error) {
    console.error('Order creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: error.message
    });
  }
});

// Verify Payment
app.post('/api/verify-payment', async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    // Validate
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing payment verification details'
      });
    }

    // Generate expected signature
    const secret = process.env.RAZORPAY_KEY_SECRET;
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Compare signatures
    if (expectedSignature === razorpay_signature) {
      // Payment verified - You can update database here
      res.json({
        success: true,
        message: 'Payment verified successfully',
        paymentId: razorpay_payment_id,
        orderId: razorpay_order_id
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Payment verification failed - Invalid signature'
      });
    }

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed',
      error: error.message
    });
  }
});

// Get Payment Details (Optional)
app.get('/api/payment/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    const payment = await razorpay.payments.fetch(paymentId);
    
    res.json({
      success: true,
      payment
    });

  } catch (error) {
    console.error('Error fetching payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details',
      error: error.message
    });
  }
});
app.post('/api/create-fund-account', async (req, res) => {
  try {
    const { memberId, name, ifsc, accountNumber } = req.body;

    if (!memberId || !name || !ifsc || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Create fund account in Razorpay
    const fundAccount = await razorpay.fundAccounts.create({
      customer_id: `customer_${memberId}`,
      account_type: 'bank_account',
      bank_account: {
        name: name,
        ifsc: ifsc,
        account_number: accountNumber
      }
    });

    res.json({
      success: true,
      fundAccountId: fundAccount.id,
      fundAccount: fundAccount
    });

  } catch (error) {
    console.error('Fund account creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create fund account',
      error: error.message
    });
  }
});

// Process Payout
app.post('/api/process-payout', async (req, res) => {
  try {
    const { 
      memberId, 
      amount, 
      bankAccount, 
      memberName, 
      memberEmail,
      type,
      description 
    } = req.body;

    // Validate
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }

    if (!bankAccount || !bankAccount.accountNumber || !bankAccount.ifsc) {
      return res.status(400).json({
        success: false,
        message: 'Bank account details required'
      });
    }

    // Check if fund account exists, if not create one
    let fundAccountId = bankAccount.fundAccountId;

    if (!fundAccountId) {
      // Create fund account
      const fundAccount = await razorpay.fundAccounts.create({
        customer_id: `customer_${memberId}`,
        account_type: 'bank_account',
        bank_account: {
          name: memberName,
          ifsc: bankAccount.ifsc,
          account_number: bankAccount.accountNumber
        }
      });
      fundAccountId = fundAccount.id;
    }

    // Create payout
    const payout = await razorpay.payouts.create({
      account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount: Math.round(amount * 100), // Convert to paise
      currency: 'INR',
      mode: 'IMPS',
      purpose: type === 'commission' ? 'commission' : 'payout',
      reference_id: `payout_${Date.now()}_${memberId}`,
      narration: description || `Payout to ${memberName}`
    });

    res.json({
      success: true,
      payoutId: payout.id,
      razorpayPayoutId: payout.id,
      fundAccountId: fundAccountId,
      amount: amount,
      status: payout.status,
      payout: payout
    });

  } catch (error) {
    console.error('Payout error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payout',
      error: error.message
    });
  }
});

// Get Payout Status
app.get('/api/payout/:payoutId', async (req, res) => {
  try {
    const { payoutId } = req.params;
    const payout = await razorpay.payouts.fetch(payoutId);
    
    res.json({
      success: true,
      payout
    });

  } catch (error) {
    console.error('Error fetching payout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payout',
      error: error.message
    });
  }
});

// Get Fund Account
app.get('/api/fund-account/:memberId', async (req, res) => {
  try {
    const { memberId } = req.params;
    // Note: Razorpay doesn't have a direct API to fetch fund account by customer_id
    // You may need to store fundAccountId in your database
    res.json({
      success: false,
      message: 'Please check fund account ID in database'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);
  console.log(`📝 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`💳 Razorpay Key: ${process.env.RAZORPAY_KEY_ID ? '✓ Configured' : '✗ Missing'}`);
});
