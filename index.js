require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion,ObjectId } = require('mongodb')
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const stripe = require('stripe')(process.env.PAYMENT_KEY)
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
if (!decoded) {
  console.warn("Warning: FB_SERVICE_KEY not found or empty. Firebase admin will not initialize.");
}



const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.62nbtq9.mongodb.net/?appName=Cluster0`;

const app = express()
// middleware
app.use(
  cors({
    origin: [process.env.DOMAIN_KEY],
    credentials: true,
    optionSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {


  try {
    // await client.connect();
     const db = client.db("online-ticket");
    const ticketsCollection = db.collection("tickets");
    const bookingsCollection = db.collection("bookings");
    const transactionsCollection = db.collection("transactions");
    const usersCollection = db.collection("users");


  // Role middlewares
const verifyAdmin = async (req, res, next) => {
  const email = req.tokenEmail;
  const user = await usersCollection.findOne({ email });
  if (user?.role !== 'admin') {
    return res.status(403).send({ message: 'Admin only Actions!', role: user?.role });
  }
  next();
};

const verifyVendor = async (req, res, next) => {
  const email = req.tokenEmail;
  const user = await usersCollection.findOne({ email });
  if (user?.role !== 'vendor') {
    return res.status(403).send({ message: 'Vendor only Actions!', role: user?.role });
  }
  next();
};

// Save or update a user in db
app.post("/user", async (req, res) => {
  const { email, name, photo } = req.body;

  if (!email) {
    return res.status(400).send({ message: "Email is required" });
  }

  const existingUser = await usersCollection.findOne({ email });

  if (existingUser) {
    // Update last login time
    await usersCollection.updateOne(
      { email },
      { $set: { lastLoggedIn: new Date() } }
    );
    return res.send({ message: "User already exists", user: existingUser });
  }

  const newUser = {
    email,
    name,
    photo,
    role: "user", 
   createdAt: new Date(),
    lastLoggedIn: new Date(),
  };

  const result = await usersCollection.insertOne(newUser);
  res.send(result);
});


// Get a user's role
app.get('/user/role', verifyJWT, async (req, res) => {
  const result = await usersCollection.findOne({ email: req.tokenEmail });
  res.send({ role: result?.role || 'user' });
});


// .............vendor.............

app.get('/vendor/tickets', verifyJWT, verifyVendor, async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).send({ message: "Email is required" });

  const tickets = await ticketsCollection.find({ vendorEmail: email }).toArray();
  res.send(tickets);
});

app.delete("/vendor/tickets/:id", verifyJWT,verifyVendor, async (req, res) => {
  const id = req.params.id;
  await ticketsCollection.deleteOne({ _id: new ObjectId(id) });
  res.send({ message: "Ticket deleted" });
});

app.get("/vendor/tickets/:id", verifyJWT,verifyVendor, async (req, res) => {
  const id = req.params.id;

  try {
    const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) });
    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found" });
    }
    res.send(ticket);
  } catch (err) {
    console.error("GET /vendor/tickets/:id error:", err);
    res.status(500).json({ message: "Failed to fetch ticket", error: err.message });
  }
});

app.patch("/vendor/tickets/:id", verifyJWT,verifyVendor, async (req, res) => {
  const id = req.params.id;
  const updateData = req.body;

  try {
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Ticket not found" });
    }

    if (result.modifiedCount === 0) {
      return res.status(200).json({ message: "No changes made" });
    }

    res.send({ message: "Ticket updated", result });
  } catch (err) {
    console.error("PATCH /vendor/tickets/:id error:", err);
    res.status(500).json({ message: "Failed to update ticket", error: err.message });
  }
});

app.get("/vendor/requests", verifyJWT, verifyVendor, async (req, res) => {
  try {
    const vendorEmail = req.query.email;
    if (!vendorEmail || vendorEmail !== req.tokenEmail) {
      return res.status(403).json({ message: "Unauthorized vendor access" });
    }
    const requests = await bookingsCollection.find({ vendorEmail }).toArray();
    res.send(requests);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch booking requests", error: err.message });
  }
});


app.patch("/vendor/bookings/:id/status", verifyJWT,verifyVendor, async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;

  try {
    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );
if (result.matchedCount === 0) {
  return res.status(404).json({ message: "Booking not found" });
}
if (result.modifiedCount === 0) {
  return res.status(200).json({ message: "No changes made" });
}


    res.send({ message: "Booking status updated", result });
  } catch (err) {
    console.error("PATCH /vendor/bookings/:id/status error:", err);
    res.status(500).json({ message: "Failed to update booking", error: err.message });
  }
});
 

// .....................admin.,,,,,,,,,,,,,,,,,,,,,,,,,,,,

// Get all users (admin only)
app.get('/users', verifyJWT, verifyAdmin, async (req, res) => {
  const result = await usersCollection.find().toArray();
  res.send(result);
});




app.get("/admin/tickets", verifyJWT, verifyAdmin, async (req, res) => {
  const tickets = await ticketsCollection.find({ approved: true }).toArray();
  res.send(tickets);
});

app.patch("/admin/tickets/:id/approve", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { approve } = req.body;
    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { approved: !!approve } }
    );
    res.json({ message: "Ticket status updated", result });
  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ message: "Failed to update ticket", error: err.message });
  }
});

app.get('/admin/users', verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const users = await usersCollection.find().toArray();
    res.send(users);
  } catch (err) {
    console.error("GET /admin/users error:", err);
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
});

app.patch('/admin/users/:id/make-admin', verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role: 'admin' } }
  );
  res.send(result);
});
  app.patch('/admin/users/:id/make-vendor', verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const result = await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { role: 'vendor' } }
  );
  res.send(result);
});


app.patch('/admin/users/:id/mark-fraud', verifyJWT, verifyAdmin, async (req, res) => {
  const id = req.params.id;

  const user = await usersCollection.findOne({ _id: new ObjectId(id) });
  if (!user || user.role !== 'vendor') {
    return res.status(400).json({ message: "User is not a vendor" });
  }

  await usersCollection.updateOne(
    { _id: new ObjectId(id) },
    { $set: { fraud: true, status: 'blocked' } }
  );

  await ticketsCollection.updateMany(
    { vendorEmail: user.email },
    { $set: { approved: false } }
  );

  res.send({ message: 'Vendor marked as fraud' });
});


app.patch("/admin/tickets/:id/advertise", verifyJWT, verifyAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { advertise } = req.body;
    console.log(advertise, id);

    if (advertise) {
      const count = await ticketsCollection.countDocuments({ advertised: true });
      if (count >= 6) {
        return res.status(400).json({ message: "Maximum 6 advertised tickets allowed" });
      }
    }

    const result = await ticketsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { advertised: !!advertise } }
    );

    res.json({ message: "Advertise toggled", result });
  } catch (err) {
    res.status(500).json({ message: "Failed to update advertise", error: err.message });
  }
});

// ..................stripe................................

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { ticketTitle, totalPrice } = req.body; 

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: ticketTitle,
            },
            unit_amount: totalPrice * 100, 
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
       success_url: `${process.env.DOMAIN_KEY}/payment-success`,
cancel_url: `${process.env.DOMAIN_KEY}/payment-cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe error:', err);
    res.status(500).send({ error: 'Payment session creation failed' });
  }
});



     //payment post
app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  try {
    const { bookingId } = req.body;

    // Find booking
    const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    // Check ownership
    if (booking.userEmail !== req.tokenEmail) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // Only accepted bookings can be paid
    if (booking.status !== "accepted") {
      return res.status(400).json({ message: "Payment allowed only after acceptance" });
    }

    // Check departure time
    const eventTime = new Date(`${booking.departureDate}T${booking.departureTime}:00`).getTime();
    if (eventTime <= Date.now()) {
      return res.status(400).json({ message: "Payment closed: departure time passed" });
    }

    // Stripe amount in cents
    const amount = Math.round(booking.totalPrice * 100);

    // Create PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      metadata: {
        bookingId: bookingId,
        ticketId: booking.ticketId.toString(),
        quantity: booking.quantity,
        title: booking.title,
      },
      automatic_payment_methods: { enabled: true }, 
    });

    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error("Payment Intent Error:", err);
    res.status(500).json({ message: err.message });
  }
});



app.get('/vendor/bookings', verifyJWT, verifyVendor, async (req, res) => {
  const email = req.tokenEmail;
  const result = await bookingsCollection.aggregate([
    { $lookup: { from: "tickets", localField: "ticketId", foreignField: "_id", as: "ticket" } },
    { $unwind: "$ticket" },
    { $match: { "ticket.vendorEmail": email } }
  ]).toArray();
  res.send(result);
});


app.get("/vendor/revenue", verifyJWT, async (req, res) => {
  const email = req.query.email;

  const totalAdded = await ticketsCollection.countDocuments({ vendorEmail: email });
  const soldBookings = await bookingsCollection.find({ vendorEmail: email, status: "paid" }).toArray();

  const ticketsSold = soldBookings.reduce((sum, b) => sum + b.quantity, 0);
  const totalRevenue = soldBookings.reduce((sum, b) => sum + b.totalPrice, 0);

  res.send({ totalAdded, ticketsSold, totalRevenue });
});



app.get("/bookings/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;
  const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
  res.send(booking);
});


    // --- Save transaction record ---

 app.post("/save-transaction", verifyJWT, async (req, res) => {
  try {
    const { transactionId, bookingId } = req.body;

    const booking = await bookingsCollection.findOne({ _id: new ObjectId(bookingId) });
    if (!booking) return res.status(404).send({ message: "Booking not found" });
    if (booking.userEmail !== req.tokenEmail) return res.status(403).send({ message: "Forbidden" });

    // Prevent double-processing
    if (booking.status === "paid") return res.status(200).send({ success: true, message: "Already paid" });

    const transactionData = {
      transactionId,
      amount: booking.totalPrice,
      title: booking.title,
      userEmail: req.tokenEmail,
      ticketId: booking.ticketId,
      bookingId: booking._id,
      quantity: booking.quantity,
      date: new Date()
    };

    await transactionsCollection.insertOne(transactionData);

    // Mark booking paid
    await bookingsCollection.updateOne(
      { _id: booking._id },
      { $set: { status: "paid" } }
    );

    // Decrement ticket quantity exactly once (Option B)
    await ticketsCollection.updateOne(
      { _id: new ObjectId(booking.ticketId) },
      { $inc: { quantity: -booking.quantity } }
    );

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ message: err.message });
  }
});

     // --- Get user transactions ---
   app.get("/transactions", verifyJWT, async (req, res) => {
    const email = req.query.email;

    if (email !== req.tokenEmail) {
        return res.status(403).send({ message: "Forbidden" });
    }

    const result = await transactionsCollection
        .find({ userEmail: email })
        .sort({ date: -1 })
        .toArray();

    res.send(result);
});

    // --- Get user profile (from users collection) ---
    app.get("/user/profile", verifyJWT, async (req, res) => {
      try {
        const userEmail = req.tokenEmail;
        const user = await usersCollection.findOne({ email: userEmail });
        res.json(user || { email: userEmail });
      } catch (err) {
        console.error("user/profile error:", err);
        res.status(500).json({ message: "Failed to fetch user profile", error: err.message });
      }
    });

    app.get('/user/bookings/details', verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        const result = await bookingsCollection.aggregate([
          { $match: { userEmail: email } },
          {
            $lookup: {
              from: "tickets",
              localField: "ticketId",
              foreignField: "_id",
              as: "ticket"
            }
          },
          { $unwind: "$ticket" }
        ]).toArray();

        res.send(result);
      } catch (err) {
        res.status(500).send({ message: "Failed to fetch user booked ticket details" });
      }
    });


    app.patch('/bookings/:id/paid', verifyJWT, async (req, res) => {
      const id = req.params.id;

      try {
        // Update booking status
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

        await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "paid" } }
        );

        // Reduce ticket quantity
        await ticketsCollection.updateOne(
          { _id: new ObjectId(booking.ticketId) },
          { $inc: { quantity: -booking.quantity } }
        );

        res.send({ message: "Payment successful" });
      } catch (err) {
        res.status(500).send({ message: "Failed to update after payment", err });
      }
    });

  
app.post('/bookings', verifyJWT, async (req, res) => {
  try {
    const { ticketId, quantity } = req.body;
    const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId.trim()) });
    if (!ticket) return res.status(404).send({ message: "Ticket not found" });

    const departure = new Date(`${ticket.departureDate} ${ticket.departureTime}`);
    if (departure < new Date()) return res.status(400).send({ message: "Departure time has already passed" });

    if (quantity <= 0) return res.status(400).send({ message: "Invalid quantity" });
    if (quantity > ticket.quantity) return res.status(400).send({ message: "Booking quantity exceeds available tickets" });

    const formattedTime = new Date(`1970-01-01 ${ticket.departureTime}`).toTimeString().slice(0, 5);

    const booking = {
      ticketId: ticket._id, 
      userEmail: req.tokenEmail,
      vendorEmail: ticket.vendorEmail,
      quantity,
      status: "pending",
      createdAt: new Date(),
      title: ticket.title,
      image: ticket.image,
      price: ticket.price,
      totalPrice: ticket.price * quantity,
      departureDate: ticket.departureDate,
      departureTime: formattedTime,
      transportType: ticket.transportType,
      from: ticket.from,
      to: ticket.to,
      perks: ticket.perks || []
    };

    await bookingsCollection.insertOne(booking);
  

    res.send({ message: "Booking successful", booking });
  } catch (err) {
    res.status(500).send({ message: "Failed to book ticket", err });
  }
});


app.get('/bookings', verifyJWT, async (req, res) => {
  try {
    const email = req.tokenEmail;
    const result = await bookingsCollection.find({ userEmail: email }).toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});

    app.get('/tickets', async (req, res) => {
      try {
        const result = await ticketsCollection.find({ approved: true }).toArray(); 
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch tickets', err });
      }
    });
 
    app.get('/tickets/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const result = await ticketsCollection.findOne({ _id: new ObjectId(id) });
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch ticket details', err });
      }
    });


     // Advertised tickets (limit 6)
   app.get("/ticket/advertised", async (req, res) => {
 
     const result = await ticketsCollection.find({ advertised: true, approved: true }).limit(6).toArray();
    console.log("Advertised tickets:", result); 
    res.json(result);
});

    // Latest tickets (8)
   app.get("/ticket/latest", async (req, res) => {
  try {
    const result = await ticketsCollection.find({ approved: true }).sort({ createdAt: -1 }).limit(8).toArray();
    console.log("Latest tickets:", result); 
    res.json(result);
  } catch (err) {
    console.error("tickets/latest error:", err);
    res.status(500).json({ message: "Failed to fetch latest tickets", error: err.message });
  }
});

     // Add ticket (vendor) 
    app.post("/tickets", verifyJWT, async (req, res) => {
      console.log(req.tokenEmail);
      
      try {
        const payload = {
          ...req.body,
          createdAt: new Date(),
          approved: false,
          advertised: false,
          vendorEmail: req.tokenEmail,
        };
        const result = await ticketsCollection.insertOne(payload);
        res.json({ message: "Ticket added (pending approval)", insertedId: result.insertedId });
      } catch (err) {
        console.error("tickets POST error:", err);
        res.status(500).json({ message: "Failed to add ticket", error: err.message });
      }
    });


     // Approve ticket (admin) 
    app.patch("/tickets/:id/approve", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await ticketsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { approved: true } });
        res.json({ message: "Ticket approved", result });
      } catch (err) {
        console.error("tickets approve error:", err);
        res.status(500).json({ message: "Failed to approve ticket", error: err.message });
      }
    });

    // Advertise toggle (admin) advertised <= 6
    app.patch("/tickets/:id/advertise", verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const { advertise } = req.body;
        if (advertise) {
          const count = await ticketsCollection.countDocuments({ advertised: true });
          if (count >= 6) return res.status(400).json({ message: "Maximum 6 advertised tickets allowed" });
        }
        const result = await ticketsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { advertised: !!advertise } });
        res.json({ message: "Advertise toggled", result });
      } catch (err) {
        console.error("tickets advertise error:", err);
        res.status(500).json({ message: "Failed to update advertise", error: err.message });
      }
    });

    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
   
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})