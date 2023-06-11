const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(cors());
app.use(express.json());

const verifyJWT = async (req, res, next) => {
  const authorization = req.headers?.authorization;
  if (!authorization) {
    res.status(401).send({ error: true, message: "Unauthorized entry" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    res.status(401).send({ error: true, message: "Unauthorized entry" });
  }

  jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      res.status(403).send({ error: true, message: "Forbidden Access" });
    }
    req.decodedEmail = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster0.v7xfdwv.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
    const userCollection = client.db("SummerCamp").collection("Users");
    const studentCollection = client.db("SummerCamp").collection("Students");
    const instructorCollection = client
      .db("SummerCamp")
      .collection("Instructors");

    // users API's
    app.post("/users", async (req, res) => {
      const user = req.body?.email;

      // get token by signing jwt.
      const token = jwt.sign(user, process.env.SECRET_ACCESS_TOKEN);
      const filter = { user };
      const existUser = await userCollection.findOne(filter);

      if (existUser) {
        existUser.token = token;
        return res.send(existUser);
      }
      const result = await userCollection.insertOne({ user, role: "student" });
      result.user = user;
      result.role = "student";
      result.token = token;
      res.send(result);
    });

    // Instructors API's
    app.get("/instructors", async (req, res) => {
      const result = await instructorCollection.find({}).toArray();
      res.send(result);
    });

    // instructors classes API's
    app.get("/classes", async (req, res) => {
      const result = await instructorCollection
        .find({ "classes.status": "approved" }, { "classes.$": 1 })
        .toArray();

      // filter all approved classes
      const len = result.length;
      let allClasses = [];
      result.forEach((data) => {
        let len = data.classes?.length || 0;
        for (let i = 0; i < len; i++) {
          if (data.classes[i].status === "approved") {
            const approvedClass = {
              ...data.classes[i],
              instructor: data?.name,
              instructor_email: data?.email,
            };
            allClasses.push(approvedClass);
          }
        }
      });
      res.send(allClasses);
    });

    // Student's API
    app.patch("/student", async (req, res) => {
      const email = req.query?.email;
      const classDetails = req.body;
      console.log(96, "api hitted", classDetails);
      const existInCollection = await studentCollection.findOne({ email });
      if (!existInCollection) {
        const { instructor, instructor_email, class_name, price, class_image } =
          classDetails;
        const newUser = {
          email,
          selectedClasses: [
            {
              instructor,
              instructor_email,
              class_name,
              class_image,
              price,
            },
          ],
        };
        console.log(112, newUser);
        const result = await studentCollection.insertOne(newUser);
        res.send(result);
      }

      // data insertion
      const filter = { email };
      // this option instructs the method to create a document if no documents match the filter
      const options = { upsert: true };
      const updatedSelectedClasses = {
        $set: {
          selectedClasses: [...existInCollection.selectedClasses, classDetails],
        },
      };
      const result = await studentCollection.updateOne(
        filter,
        updatedSelectedClasses,
        options
      );
      console.log(existInCollection);
      if (result?.modifiedCount > 0) {
        const filter = {};
      }
      res.send(result);
    });
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Summer Camp Server is running");
});

app.listen(port, () => {
  console.log("summer camp  server is running on port 5000");
});
