import express, { Router, Request, type Response } from 'express'
import Stripe from 'stripe'
import { requireAuth } from '../middleware/authMiddleware.js'
import { type AuthRequest } from '../types/auth.js'
import { prisma } from '../config/prisma.js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2023-10-16'
})

export const subscriptionRouter = Router()

// Get subscription status
subscriptionRouter.get('/status', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { subscription: true }
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    res.json({
      subscription: user.subscription,
      features: {
        maxTailorings: user.subscription?.plan === 'premium' ? -1 : 5,
        atsAnalysis: user.subscription?.plan === 'premium',
        industryInsights: user.subscription?.plan === 'premium',
        performanceTracking: user.subscription?.plan === 'premium',
        multiFormatExport: user.subscription?.plan === 'premium'
      }
    })
  } catch (error) {
    console.error('Get subscription status error:', error)
    res.status(500).json({ error: 'Failed to get subscription status' })
  }
})

// Create checkout session
subscriptionRouter.post('/create-checkout-session', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { subscription: true }
    })

    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Create or get Stripe customer
    let customerId = user.subscription?.stripeCustomerId

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: {
          userId: user.id
        }
      })
      customerId = customer.id

      // Update subscription with customer ID
      await prisma.subscription.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          status: 'INCOMPLETE',
          plan: 'free',
          stripeCustomerId: customerId
        },
        update: {
          stripeCustomerId: customerId
        }
      })
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.STRIPE_PREMIUM_PRICE_ID || 'price_1234567890',
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.FRONTEND_URL}/dashboard?success=true`,
      cancel_url: `${process.env.FRONTEND_URL}/pricing?canceled=true`,
      metadata: {
        userId: user.id
      }
    })

    res.json({ sessionId: session.id })
  } catch (error) {
    console.error('Create checkout session error:', error)
    res.status(500).json({ error: 'Failed to create checkout session' })
  }
})

// Handle Stripe webhooks
subscriptionRouter.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET

  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig!, endpointSecret!)
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object)
        break

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object)
        break

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object)
        break

      default:
        console.log(`Unhandled event type ${event.type}`)
    }

    res.json({ received: true })
  } catch (error) {
    console.error('Webhook handler error:', error)
    res.status(500).json({ error: 'Webhook handler failed' })
  }
})

// Cancel subscription
subscriptionRouter.post('/cancel', requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' })
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { subscription: true }
    })

    if (!user?.subscription?.stripeSubscriptionId) {
      return res.status(404).json({ error: 'No active subscription found' })
    }

    await stripe.subscriptions.update(user.subscription.stripeSubscriptionId, {
      cancel_at_period_end: true
    })

    await prisma.subscription.update({
      where: { userId: user.id },
      data: { cancelAtPeriodEnd: true }
    })

    res.json({ message: 'Subscription will be canceled at the end of the current period' })
  } catch (error) {
    console.error('Cancel subscription error:', error)
    res.status(500).json({ error: 'Failed to cancel subscription' })
  }
})

// Helper functions for webhook handlers
async function handleCheckoutCompleted (session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId
  if (!userId) return

  const subscription = await stripe.subscriptions.retrieve(session.subscription as string)

  await prisma.subscription.update({
    where: { userId },
    data: {
      status: 'ACTIVE',
      plan: 'premium',
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: false
    }
  })
}

async function handleSubscriptionUpdated (subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string

  const user = await prisma.user.findFirst({
    where: {
      subscription: {
        stripeCustomerId: customerId
      }
    }
  })

  if (!user) return

  await prisma.subscription.update({
    where: { userId: user.id },
    data: {
      status: subscription.status.toUpperCase() as any,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
      cancelAtPeriodEnd: subscription.cancel_at_period_end
    }
  })
}

async function handleSubscriptionDeleted (subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string

  const user = await prisma.user.findFirst({
    where: {
      subscription: {
        stripeCustomerId: customerId
      }
    }
  })

  if (!user) return

  await prisma.subscription.update({
    where: { userId: user.id },
    data: {
      status: 'CANCELED',
      plan: 'free',
      stripeSubscriptionId: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false
    }
  })
}

async function handlePaymentFailed (invoice: Stripe.Invoice) {
  const customerId = invoice.customer as string

  const user = await prisma.user.findFirst({
    where: {
      subscription: {
        stripeCustomerId: customerId
      }
    }
  })

  if (!user) return

  await prisma.subscription.update({
    where: { userId: user.id },
    data: {
      status: 'PAST_DUE'
    }
  })
}
