const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(
  "sk_test_51NIOs3A4HBh5KLUQ6vJ5SBthO99cvw4sRkAEYJScGfxvZE7wtZs7EyRYtJjrcett0i63IqqT9NcDWOGnXy0BlXLD00DlWRXk9C"
);
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
    return res.status(401).send({ error: true, message: "Unauthorized entry" });
  }
  const token = authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ error: true, message: "Unauthorized entry" });
  }

  jwt.verify(token, process.env.SECRET_ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      return res.status(403).send({ error: true, message: "Forbidden Access" });
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

// create payment key;
app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  const email = req.query.email;
  if (email !== req.decodedEmail) {
    return res.status(401).send({ error: true, message: "Invalid Email" });
  }

  const { price } = req.body;
  const amount = price * 100;
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount,
    currency: "usd",
    payment_method_types: ["card"],
  });
  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

async function run() {
  try {
    const userCollection = client.db("SummerCamp").collection("Users");
    const studentCollection = client.db("SummerCamp").collection("Students");
    const paymentCollection = client.db("SummerCamp").collection("payments");
    const instructorCollection = client
      .db("SummerCamp")
      .collection("Instructors");

    // users API's
    app.post("/users", async (req, res) => {
      const user = req.body.user;
      // get token by signing jwt.
      const token = jwt.sign(user.email, process.env.SECRET_ACCESS_TOKEN);
      const filter = { user: user.email };
      const existUser = await userCollection.findOne(filter);

      if (existUser) {
        existUser.token = token;
        return res.send(existUser);
      }

      const userInfo = {
        user: user.email,
        role: "student",
        name: user.name,
        image: user.image,
      };
      const result = await userCollection.insertOne(userInfo);
      result.role = "student";
      result.token = token;
      res.send(result);
    });

    // Home page classes api
    app.get("/popularClasses", async (req, res) => {
      const pipeline = [
        { $unwind: "$classes" }, // Unwind the classes array
        { $sort: { "classes.student": 1 } }, // Sort based on the student's value in ascending order
        { $group: { _id: null, classes: { $push: "$classes" } } }, // Group the classes objects into one array
      ];
      const result = await instructorCollection.aggregate(pipeline).toArray();
      const sortedClass = result[0].classes.sort(
        (a, b) => b.students - a.students
      );
      sortedClass.length = 6;
      res.send(sortedClass);
    });
    // Home page classes api
    app.get("/popularInstructor", async (req, res) => {
      const result = await instructorCollection.find().toArray();
      result.length = 6;
      res.send(result);
    });

    // payment api
    app.post("/payments", async (req, res) => {
      const paymentDetails = req.body;
      const userInfo = await paymentCollection.findOne({
        user: paymentDetails.user,
      });
      if (!userInfo) {
        const userPaymentDoc = {
          user: paymentDetails.user,
          payments: [
            {
              date: paymentDetails.date,
              class_name: paymentDetails.class_name,
              instructor_email: paymentDetails.instructor_email,
              payment_id: paymentDetails.payment_id,
              payment_method: paymentDetails.payment_method,
            },
          ],
        };
        const result = await paymentCollection.insertOne(userPaymentDoc);
      } else {
        const result = await paymentCollection.updateOne(
          { user: paymentDetails.user },
          {
            $push: {
              payments: {
                date: paymentDetails.date,
                class_name: paymentDetails.class_name,
                instructor_email: paymentDetails.instructor_email,
                payment_id: paymentDetails.payment_id,
                payment_method: paymentDetails.payment_method,
              },
            },
          }
        );
      }

      const updatedSelectedClass = await studentCollection.updateOne(
        { email: paymentDetails.user },
        {
          $pull: {
            selectedClasses: { class_name: paymentDetails.class_name },
          },
        }
      );
      const updatedEnrollClasses = await studentCollection.updateOne(
        { email: paymentDetails.user },
        {
          $push: {
            enrolledClasses: {
              instructor: paymentDetails.instructor,
              instructor_email: paymentDetails.instructor_email,
              class_name: paymentDetails.class_name,
            },
          },
        },
        { upsert: true }
      );
      const updateInstructor = await instructorCollection.updateOne(
        {
          email: paymentDetails.instructor_email,
          classes: { $elemMatch: { name: paymentDetails.class_name } },
        },
        {
          $inc: {
            "classes.$.available_seats": -1,
            "classes.$.students": 1,
          },
          $push: {
            "classes.$.student_list": { email: paymentDetails.user },
          },
        },
        { upsert: true }
      );
      res.send({ updated: true });
    });

    // Instructors API's
    app.get("/instructors", async (req, res) => {
      const result = await instructorCollection.find({}).toArray();
      res.send(result);
    });

    app.post("/addClass", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }

      const { available_seats, image, name, price } = req.body;
      const newClass = {
        name,
        image,
        available_seats,
        price,
        students: 0,
        student_list: [],
        status: "pending",
      };
      const result = await instructorCollection.updateOne(
        { email },
        { $push: { classes: newClass } },
        { upsert: true }
      );
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
    app.get("/myClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const result = await instructorCollection.find({ email }).toArray();
      res.send(result);
    });

    // Admin API's
    app.get("/users", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }

      const result = await userCollection.find({}).toArray();
      res.send(result);
    });

    app.put("/users", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const updatedUser = req.body;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }

      const filter = { user: updatedUser.user };
      const updatedDoc = {
        $set: { role: updatedUser.role },
      };
      const options = { upsert: true };

      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      if (result.modifiedCount > 0 && updatedUser.role === "instructor") {
        const newInstructor = {
          name: updatedUser.name,
          email: updatedUser.user,
          image: updatedUser?.image,
          classes: [],
        };
        const insertedResult = await instructorCollection.insertOne(
          newInstructor
        );
        return res.send(insertedResult);
      } else {
        const deletedResult = await instructorCollection.deleteOne({
          email: updatedUser.user,
        });
        return res.send(deletedResult);
      }
    });
    app.post("/addFeedback", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const feedbackDetails = req.body;

      const filter = { email: feedbackDetails.instructor_email };
      const updatedDoc = {
        $set: {
          "classes.$[elem].feedback": feedbackDetails.feedback,
        },
      };
      const options = {
        arrayFilters: [{ "elem.name": feedbackDetails.name }],
      };
      const result = await instructorCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });
    app.put("/allClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const classDetails = req.body;

      const filter = { email: classDetails.instructor_email };
      const updatedDoc = {
        $set: {
          "classes.$[elem].status": classDetails.status,
        },
      };
      const options = {
        arrayFilters: [{ "elem.name": classDetails.name }],
      };
      const result = await instructorCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.get("/allClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const updatedUser = req.body;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }

      const allInstructors = await instructorCollection.find().toArray();

      const allClasses = [];

      allInstructors.forEach((singleInstructor) => {
        const len = singleInstructor.classes.length;
        for (let i = 0; i < len; i++) {
          singleInstructor.classes[i].instructor = singleInstructor.name;
          singleInstructor.classes[i].instructor_email = singleInstructor.email;
          allClasses.push(singleInstructor.classes[i]);
        }
      });

      res.send(allClasses);
    });

    // Student's API

    app.get("/selectedClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const result = await studentCollection.findOne({ email });
      res.send(result);
    });

    app.get("/paymentDetails", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const result = await paymentCollection.findOne({ user: email });
      if (result) {
        const len = result.payments.length;
        const sortedData = [];
        for (let i = len - 1; i >= 0; i--) {
          sortedData.push(result.payments[i]);
        }
        res.send(sortedData);
      }
    });

    app.get("/enrolledClasses", verifyJWT, async (req, res) => {
      const email = req.query.email;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const result = await studentCollection.findOne({ email });
      res.send(result.enrolledClasses);
    });

    app.patch("/selectedClasses", async (req, res) => {
      const email = req.query?.email;
      const classDetails = req.body;
      const userDetails = await studentCollection.findOne({ email });
      if (!userDetails) {
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
        const result = await studentCollection.insertOne(newUser);
        return res.send(result);
      }

      // filter whether the selected class already exist in students mySelectedClasses object
      const existInSelectedClasses = userDetails.selectedClasses.find((el) => {
        return (
          el?.class_name === classDetails?.class_name &&
          el?.instructor == classDetails?.instructor
        );
      });
      if (existInSelectedClasses) {
        return res.send({ alreadySelected: true });
      }
      // data insertion
      const filter = { email };
      const options = { upsert: true };
      const updatedSelectedClasses = {
        $set: {
          selectedClasses: [...userDetails.selectedClasses, classDetails],
        },
      };
      const result = await studentCollection.updateOne(
        filter,
        updatedSelectedClasses,
        options
      );
      res.send(result);
    });

    app.put("/removeSelectedClass", verifyJWT, async (req, res) => {
      const email = req.query.email;
      const classDetails = req.body;
      if (email !== req.decodedEmail) {
        return res.status(401).send({ error: true, message: "Invalid Email" });
      }
      const filter = {
        email,
      };
      const studentDetails = await studentCollection.findOne(filter);
      const updatedSelectedClasses = studentDetails?.selectedClasses.filter(
        (singleClass) =>
          singleClass.class_name !== classDetails?.class_name &&
          singleClass?.instructor_email !== classDetails?.instructor_email
      );
      const updatedDoc = {
        $set: {
          selectedClasses: updatedSelectedClasses,
        },
      };

      const result = await studentCollection.updateOne(filter, updatedDoc, {
        upsert: true,
      });
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
