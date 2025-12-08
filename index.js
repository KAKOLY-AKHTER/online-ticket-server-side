require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion } = require('mongodb')
const { ObjectId } = require('mongodb');
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.62nbtq9.mongodb.net/?appName=Cluster0`;

const app = express()
// middleware
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'https://b12-m11-session.web.app',
    ],
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
    await client.connect();
    const ticketsCollection = client.db('online-ticket').collection('tickets');
    const bookingsCollection = client.db('online-ticket').collection('bookings');

app.get('/user/profile', verifyJWT, async (req, res) => {
  try {
    const userEmail = req.tokenEmail;

    const user = await client
      .db("online-ticket")
      .collection("users")
      .findOne({ email: userEmail });

    res.send(user);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch user profile" });
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


app.patch('/bookings/:id/status', verifyJWT, async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;

    const result = await bookingsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { status } }
    );

    res.send({ message: "Booking updated", result });
  } catch (err) {
    res.status(500).send({ message: "Failed to update status" });
  }
});



app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  const { amount } = req.body; // amount in BDT * 100

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: "usd",
      payment_method_types: ["card"],
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    res.status(500).send({ message: "Payment failed", err });
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


app.post('/transactions', verifyJWT, async (req, res) => {
  try {
    const data = {
      ...req.body,
      userEmail: req.tokenEmail,
      date: new Date()
    };

    await client.db("online-ticket")
      .collection("transactions")
      .insertOne(data);

    res.send({ message: "Transaction saved" });
  } catch (err) {
    res.status(500).send({ message: "Failed to save transaction" });
  }
});

app.get('/transactions', verifyJWT, async (req, res) => {
  try {
    const email = req.tokenEmail;

    const result = await client
      .db("online-ticket")
      .collection("transactions")
      .find({ userEmail: email })
      .toArray();

    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch transactions" });
  }
});

    app.post('/bookings', verifyJWT, async (req, res) => {
      try {
        const { ticketId, quantity } = req.body;

        // Ticket খুঁজে বের করো
       const ticket = await ticketsCollection.findOne({ _id: new ObjectId(ticketId.trim()) });
        if (!ticket) return res.status(404).send({ message: "Ticket not found" });

        // Departure time check
        const departure = new Date(`${ticket.departureDate} ${ticket.departureTime}`);
        if (departure < new Date()) {
          return res.status(400).send({ message: "Departure time has already passed" });
        }

        // Quantity check
        if (ticket.quantity === 0) {
          return res.status(400).send({ message: "No tickets available" });
        }
        if (quantity > ticket.quantity) {
          return res.status(400).send({ message: "Booking quantity exceeds available tickets" });
        }

        // Booking object তৈরি
        const booking = {
          ticketId,
          userEmail: req.tokenEmail, // JWT থেকে আসা user email
          quantity,
          status: "Pending",
          createdAt: new Date()
        };

        // Booking save করো
        await bookingsCollection.insertOne(booking);

        // Ticket quantity কমাও
        await ticketsCollection.updateOne(
          { _id: new ObjectId(ticketId) },
          { $inc: { quantity: -quantity } }
        );

        res.send({ message: "Booking successful", booking });
      } catch (err) {
        res.status(500).send({ message: "Failed to book ticket", err });
      }
    });


    app.get('/bookings', verifyJWT, async (req, res) => {
  try {
    // ✅ শুধু JWT থেকে আসা email ব্যবহার করো
    const email = req.tokenEmail;

    const result = await bookingsCollection.find({ userEmail: email }).toArray();
    res.send(result);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch bookings" });
  }
});



    app.patch('/tickets/:id/approve', verifyJWT, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await ticketsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { approved: true } }
        );
        res.send({ message: "Ticket approved successfully", result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to approve ticket', err });
      }
    });


    app.get('/tickets', async (req, res) => {
      try {
        const result = await ticketsCollection.find({ approved: true }).toArray(); // ✅ শুধু approved tickets
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


    app.get('/tickets/advertised', async (req, res) => {
      try {
        const result = await ticketsCollection.find({ advertised: true }).limit(6).toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch advertised tickets', err });
      }
    });


    app.get('/tickets/latest', async (req, res) => {
      try {
        const result = await ticketsCollection
          .find()
          .sort({ createdAt: -1 })
          .limit(8)
          .toArray();
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch latest tickets', err });
      }
    });


    app.post('/tickets', async (req, res) => {
      try {
        const ticket = {
          ...req.body,
          createdAt: new Date(),
          approved: false // ✅ default false, admin পরে approve করবে
        };
        const result = await ticketsCollection.insertOne(ticket);
        res.send(result);
      } catch (err) {
        res.status(500).send({ message: 'Failed to add ticket', err });
      }
    });


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})